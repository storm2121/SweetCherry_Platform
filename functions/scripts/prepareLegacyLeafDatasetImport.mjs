import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_PROJECT_ID = 'sweetcherry-4caf3'
const DEFAULT_STORAGE_BUCKET = 'sweetcherry-4caf3.firebasestorage.app'
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID
const DATASET_IMAGES_COLLECTION = 'datasetImages'
const DATASET_IMPORTS_COLLECTION = 'datasetImports'
const DEFAULT_UPLOAD_CONCURRENCY = 8
const DEFAULT_SOURCES = [
  {
    key: 'kaggle_leaves_6_88',
    name: 'Kaggle Leaves 6.88 diseases',
    root: 'D:\\FarmData\\Leaves\\Kaggle_Leaves_6.88_diseases',
  },
  {
    key: 'kaggle_leaves_7_5',
    name: 'Kaggle Leaves 7.5',
    root: 'D:\\FarmData\\Leaves\\Kaggle_Leaves_7.5',
  },
]

const LABEL_MAP = new Map([
  ['cherry brown_spot', 'brown_spot'],
  ['cherry leaf scorch', 'leaf_scorch'],
  ['cherry normal leaf', 'healthy'],
  ['cherry purple leaf spot', 'purple_leaf_spot'],
  ['cherry_shot hole disease', 'shot_hole'],
  ['cherry_(including_sour)___healthy', 'healthy'],
  ['cherry_(including_sour)___powdery_mildew', 'powdery_mildew'],
])

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const EFFECTIVE_SPLITS = [
  { name: 'train', maxPercent: 70 },
  { name: 'valid', maxPercent: 85 },
  { name: 'test', maxPercent: 100 },
]

function parseArgs(argv) {
  const options = {
    dryRun: false,
    upload: false,
    limit: null,
    concurrency: DEFAULT_UPLOAD_CONCURRENCY,
    storageBucket: process.env.LEGACY_DATASET_STORAGE_BUCKET || DEFAULT_STORAGE_BUCKET,
    sources: DEFAULT_SOURCES.map((source) => ({ ...source })),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]

    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--upload') {
      options.upload = true
    } else if (arg === '--limit' && value) {
      options.limit = Number.parseInt(value, 10)
      index += 1
    } else if (arg === '--concurrency' && value) {
      options.concurrency = Number.parseInt(value, 10)
      index += 1
    } else if (arg === '--bucket' && value) {
      options.storageBucket = value
      index += 1
    } else if (arg === '--root-688' && value) {
      options.sources[0].root = value
      index += 1
    } else if (arg === '--root-75' && value) {
      options.sources[1].root = value
      index += 1
    } else if (arg === '--help') {
      options.help = true
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  if (options.dryRun && options.upload) {
    throw new Error('Choose either --dry-run or --upload, not both.')
  }
  if (options.limit != null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error('--limit must be a positive integer.')
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
    throw new Error('--concurrency must be a positive integer.')
  }

  return options
}

function usage() {
  return [
    'Usage:',
    '  npm --prefix functions run dataset:dry-run',
    '  npm --prefix functions run dataset:upload',
    '  node functions/scripts/prepareLegacyLeafDatasetImport.mjs --dry-run',
    '  node functions/scripts/prepareLegacyLeafDatasetImport.mjs --upload',
    '',
    'Optional path overrides:',
    '  --root-688 "D:\\FarmData\\Leaves\\Kaggle_Leaves_6.88_diseases"',
    '  --root-75 "D:\\FarmData\\Leaves\\Kaggle_Leaves_7.5"',
    '  --limit 25',
    '  --concurrency 8',
    '  --bucket sweetcherry-4caf3.firebasestorage.app',
    '',
    'Dry-run is read-only. Upload mode only creates/skips records; it never deletes files or documents.',
  ].join('\n')
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/')
}

function stableHash(input, length = 24) {
  return createHash('sha1').update(input).digest('hex').slice(0, length)
}

function effectiveSplitFor(sourceKey, relativePath) {
  const hex = stableHash(`${sourceKey}:${relativePath}`, 8)
  const percent = Number.parseInt(hex, 16) % 100
  return EFFECTIVE_SPLITS.find((split) => percent < split.maxPercent)?.name ?? 'test'
}

function originalSplitFromParts(parts) {
  const normalized = parts.map((part) => part.toLowerCase())
  if (normalized.includes('train')) return 'train'
  if (normalized.includes('valid') || normalized.includes('validation')) return 'valid'
  if (normalized.includes('test')) return 'test'
  return 'unknown'
}

function problemFromLabelFolder(labelFolder) {
  return LABEL_MAP.get(labelFolder.toLowerCase()) ?? null
}

function proposedStoragePath(row) {
  const extension = path.extname(row.fileName).toLowerCase()
  return [
    'datasets',
    'legacy',
    'cherry_leaf',
    row.sourceDataset,
    row.effectiveSplit,
    row.problemType,
    `${row.id}${extension}`,
  ].join('/')
}

function contentTypeFor(fileName) {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function publicDoc(row, { imageUrl = null, importBatchId = '<created during upload>', timestamp = '<server timestamp during upload>' } = {}) {
  return {
    source: 'legacy_dataset',
    sourceDataset: row.sourceDataset,
    sourceName: row.sourceName,
    bodyPart: 'leaf',
    problemType: row.problemType,
    labels: [row.problemType],
    labelMode: 'single_label',
    status: 'active',
    originalSplit: row.originalSplit,
    effectiveSplit: row.effectiveSplit,
    originalRelativePath: row.relativePath,
    imagePath: proposedStoragePath(row),
    imageUrl,
    fileName: row.fileName,
    contentType: contentTypeFor(row.fileName),
    expertMetadata: null,
    imageQuality: null,
    severity: null,
    confidence: null,
    spread: null,
    symptoms: [],
    importBatchId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

async function walkImages(root) {
  const files = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await readdir(current, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)

      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }

      if (!entry.isFile()) continue

      const extension = path.extname(entry.name).toLowerCase()
      if (IMAGE_EXTENSIONS.has(extension)) {
        files.push(fullPath)
      }
    }
  }

  files.sort((first, second) => first.localeCompare(second))
  return files
}

async function collectSourceRows(source) {
  const rootStats = await stat(source.root)
  if (!rootStats.isDirectory()) {
    throw new Error(`${source.root} is not a directory`)
  }

  const imageFiles = await walkImages(source.root)
  const rows = []
  const skipped = []

  for (const fullPath of imageFiles) {
    const relativePath = normalizePath(path.relative(source.root, fullPath))
    const parts = relativePath.split('/')
    const fileName = parts.at(-1)
    const labelFolder = parts.at(-2)
    const problemType = problemFromLabelFolder(labelFolder)

    if (!problemType) {
      skipped.push({
        reason: 'unmapped_label_folder',
        labelFolder,
        relativePath,
      })
      continue
    }

    const originalSplit = originalSplitFromParts(parts)
    const effectiveSplit = effectiveSplitFor(source.key, relativePath)
    const id = `legacy_leaf_${stableHash(`${source.key}:${relativePath}`)}`

    rows.push({
      id,
      sourceDataset: source.key,
      sourceName: source.name,
      fullPath,
      relativePath,
      fileName,
      originalSplit,
      effectiveSplit,
      problemType,
      storagePath: proposedStoragePath({ id, fileName, sourceDataset: source.key, effectiveSplit, problemType }),
    })
  }

  return { source, rows, skipped }
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount)
}

function buildSummary(results) {
  const rows = results.flatMap((result) => result.rows)
  const skipped = results.flatMap((result) => result.skipped)
  const bySource = new Map()
  const byProblem = new Map()
  const byOriginalSplit = new Map()
  const byEffectiveSplit = new Map()
  const byProblemAndEffectiveSplit = new Map()
  const imageCountsByProblem = new Map()

  for (const row of rows) {
    increment(bySource, row.sourceDataset)
    increment(byProblem, row.problemType)
    increment(byOriginalSplit, row.originalSplit)
    increment(byEffectiveSplit, row.effectiveSplit)
    increment(byProblemAndEffectiveSplit, `${row.problemType} / ${row.effectiveSplit}`)
    increment(imageCountsByProblem, row.problemType)
  }

  return {
    rows,
    skipped,
    bySource,
    byProblem,
    byOriginalSplit,
    byEffectiveSplit,
    byProblemAndEffectiveSplit,
    imageCountsByProblem,
  }
}

function printMap(title, map) {
  console.log(`\n${title}`)
  for (const [key, count] of [...map.entries()].sort(([first], [second]) => first.localeCompare(second))) {
    console.log(`  ${key}: ${count}`)
  }
}

function printSamples(rows) {
  const samplesByProblem = new Map()
  for (const row of rows) {
    if (!samplesByProblem.has(row.problemType)) {
      samplesByProblem.set(row.problemType, row)
    }
  }

  console.log('\nSample proposed Firebase records')
  for (const [problemType, row] of [...samplesByProblem.entries()].sort(([first], [second]) => first.localeCompare(second))) {
    console.log(`\n${problemType}`)
    console.log(`  documentId: ${row.id}`)
    console.log(`  storagePath: ${proposedStoragePath(row)}`)
    console.log(`  firestoreDoc: ${JSON.stringify(publicDoc(row), null, 2)}`)
  }
}

async function getFirebaseAdmin(storageBucket) {
  const [{ initializeApp, getApps }, { getFirestore, FieldValue }, { getStorage, getDownloadURL }] =
    await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
      import('firebase-admin/storage'),
    ])

  const app = getApps()[0] ?? initializeApp({
    projectId: PROJECT_ID,
    storageBucket,
  })

  return {
    db: getFirestore(app),
    bucket: getStorage(app).bucket(),
    FieldValue,
    getDownloadURL,
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      await worker(items[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)
}

async function uploadRows(rows, options) {
  const { db, bucket, FieldValue, getDownloadURL } = await getFirebaseAdmin(options.storageBucket)
  const selectedRows = options.limit ? rows.slice(0, options.limit) : rows
  const importBatchId = `legacy_leaf_${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`
  const counters = {
    total: selectedRows.length,
    uploaded: 0,
    skippedExisting: 0,
    failed: 0,
  }
  const failures = []

  console.log(`\nUploading ${selectedRows.length} images to Firebase project ${PROJECT_ID}`)
  console.log(`Storage bucket: ${options.storageBucket}`)
  console.log(`Import batch: ${importBatchId}`)
  console.log('No delete operations are available in this importer.')

  await db.collection(DATASET_IMPORTS_COLLECTION).doc(importBatchId).set({
    source: 'legacy_leaf_dataset',
    status: 'running',
    projectId: PROJECT_ID,
    storageBucket: options.storageBucket,
    totalRows: selectedRows.length,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await runWithConcurrency(selectedRows, options.concurrency, async (row, index) => {
    const docRef = db.collection(DATASET_IMAGES_COLLECTION).doc(row.id)
    const existing = await docRef.get()
    if (existing.exists) {
      counters.skippedExisting += 1
      return
    }

    try {
      const storagePath = proposedStoragePath(row)
      const file = bucket.file(storagePath)

      await bucket.upload(row.fullPath, {
        destination: storagePath,
        resumable: false,
        metadata: {
          contentType: contentTypeFor(row.fileName),
          cacheControl: 'public,max-age=31536000',
          metadata: {
            importBatchId,
            sourceDataset: row.sourceDataset,
            problemType: row.problemType,
            bodyPart: 'leaf',
          },
        },
      })

      const imageUrl = await getDownloadURL(file)
      await docRef.set(publicDoc(row, {
        imageUrl,
        importBatchId,
        timestamp: FieldValue.serverTimestamp(),
      }))

      counters.uploaded += 1
      const processed = counters.uploaded + counters.skippedExisting + counters.failed
      if (processed % 100 === 0 || processed === selectedRows.length) {
        console.log(
          `  processed ${processed}/${selectedRows.length} | uploaded ${counters.uploaded} | skipped ${counters.skippedExisting} | failed ${counters.failed}`,
        )
      }
    } catch (error) {
      counters.failed += 1
      failures.push({
        id: row.id,
        relativePath: row.relativePath,
        message: error?.message || String(error),
      })
      console.warn(`  failed ${index + 1}/${selectedRows.length}: ${row.relativePath} (${error?.message})`)
    }
  })

  const status = counters.failed ? 'completed_with_errors' : 'completed'
  await db.collection(DATASET_IMPORTS_COLLECTION).doc(importBatchId).set(
    {
      status,
      uploaded: counters.uploaded,
      skippedExisting: counters.skippedExisting,
      failed: counters.failed,
      failures: failures.slice(0, 25),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  console.log('\nUpload summary')
  console.log(`  total selected: ${counters.total}`)
  console.log(`  uploaded: ${counters.uploaded}`)
  console.log(`  skipped existing: ${counters.skippedExisting}`)
  console.log(`  failed: ${counters.failed}`)
  console.log(`  import record: ${DATASET_IMPORTS_COLLECTION}/${importBatchId}`)

  if (failures.length) {
    console.log('\nFailure examples')
    failures.slice(0, 10).forEach((failure) => {
      console.log(`  ${failure.relativePath}: ${failure.message}`)
    })
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    console.log(usage())
    return
  }

  if (!options.dryRun && !options.upload) {
    throw new Error('Choose --dry-run or --upload.')
  }

  if (options.dryRun) {
    console.log('Legacy leaf dataset import dry run')
    console.log('No Firebase writes will be performed.')
  } else {
    console.log('Legacy leaf dataset upload')
    console.log('This creates Storage files and Firestore documents only. It never deletes anything.')
  }

  const results = []
  for (const source of options.sources) {
    console.log(`\nScanning ${source.name}`)
    console.log(`  ${source.root}`)
    const result = await collectSourceRows(source)
    results.push(result)
    console.log(`  usable images: ${result.rows.length}`)
    console.log(`  skipped images: ${result.skipped.length}`)
  }

  const summary = buildSummary(results)

  console.log(`\nTotal usable images: ${summary.rows.length}`)
  console.log(`Total skipped images: ${summary.skipped.length}`)
  printMap('By source dataset', summary.bySource)
  printMap('By normalized problem label', summary.byProblem)
  printMap('By original split', summary.byOriginalSplit)
  printMap('By effective split', summary.byEffectiveSplit)
  printMap('By problem and effective split', summary.byProblemAndEffectiveSplit)

  if (summary.skipped.length > 0) {
    console.log('\nSkipped examples')
    for (const skipped of summary.skipped.slice(0, 10)) {
      console.log(`  ${skipped.reason}: ${skipped.labelFolder} -> ${skipped.relativePath}`)
    }
  }

  printSamples(summary.rows)

  if (options.upload) {
    await uploadRows(summary.rows, options)
  }
}

main().catch((error) => {
  console.error(`\nDry run failed: ${error.message}`)
  process.exitCode = 1
})
