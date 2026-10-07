import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PROJECT_ID = 'sweetcherry-4caf3'
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID
const MODEL_TRAINING_JOBS = 'modelTrainingJobs'
const LEAF_LABEL_ORDER = [
  'healthy',
  'powdery_mildew',
  'brown_spot',
  'leaf_scorch',
  'purple_leaf_spot',
  'shot_hole',
]
const EXCLUDED_LABELS = new Set(['unknown_needs_more_info', 'other'])
const SPLITS = ['train', 'valid', 'test']
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')

function parseArgs(argv) {
  const options = {
    jobId: '',
    outDir: '',
    labels: null,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]

    if (arg === '--job-id' && value) {
      options.jobId = value
      index += 1
    } else if (arg === '--out' && value) {
      options.outDir = value
      index += 1
    } else if (arg === '--labels' && value) {
      options.labels = value.split(',').map((label) => label.trim()).filter(Boolean)
      index += 1
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--help') {
      options.help = true
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  if (!options.help && !options.jobId) {
    throw new Error('Missing required --job-id.')
  }

  return options
}

function usage() {
  return [
    'Usage:',
    '  npm --prefix functions run training:export -- --job-id MODEL_TRAINING_JOB_ID',
    '  npm --prefix functions run training:export -- --job-id MODEL_TRAINING_JOB_ID --out "D:\\SweetCherryTrainingRuns\\job-id"',
    '',
    'Optional:',
    '  --labels healthy,powdery_mildew,brown_spot,leaf_scorch,purple_leaf_spot,shot_hole',
    '  --dry-run',
    '',
    'This export is metadata-only. It does not train and does not download image files.',
  ].join('\n')
}

function stableHash(input, length = 8) {
  return createHash('sha1').update(String(input)).digest('hex').slice(0, length)
}

function stableSplit(input) {
  const value = Number.parseInt(stableHash(input, 8), 16) % 100
  if (value < 70) return 'train'
  if (value < 85) return 'valid'
  return 'test'
}

function normalizeSplit(value, fallbackKey) {
  if (SPLITS.includes(value)) return value
  return stableSplit(fallbackKey)
}

function normalizeLabels(labels = [], targetPart = 'leaf') {
  const clean = Array.from(new Set(labels.filter((label) => label && !EXCLUDED_LABELS.has(label))))
  const preferredOrder = targetPart === 'leaf' ? LEAF_LABEL_ORDER : []
  const ordered = [
    ...preferredOrder.filter((label) => clean.includes(label)),
    ...clean
      .filter((label) => !preferredOrder.includes(label))
      .sort((first, second) => first.localeCompare(second)),
  ]
  return ordered.length ? ordered : preferredOrder
}

function enforceHealthyExclusivity(labelSet) {
  const diseaseLabels = [...labelSet].filter((label) => label !== 'healthy')
  if (diseaseLabels.length) {
    labelSet.delete('healthy')
  }
  return labelSet
}

function buildTarget(labelSet, labels) {
  return labels.map((label) => (labelSet.has(label) ? 1 : 0))
}

function safeImageRef(imagePath = '') {
  const extension = path.extname(imagePath).toLowerCase() || '.jpg'
  return `${stableHash(imagePath, 24)}${extension}`
}

function timestampValue(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') return value
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return null
}

async function getFirebaseAdmin() {
  const [{ initializeApp, getApps }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ])

  const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
  return { db: getFirestore(app) }
}

async function loadTrainingJob(jobId) {
  const { db } = await getFirebaseAdmin()
  const jobRef = db.collection(MODEL_TRAINING_JOBS).doc(jobId)
  const jobSnap = await jobRef.get()
  if (!jobSnap.exists) {
    throw new Error(`${MODEL_TRAINING_JOBS}/${jobId} was not found.`)
  }

  const itemsSnap = await jobRef.collection('manifestItems').get()
  const items = itemsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }))

  return {
    job: { id: jobSnap.id, ...jobSnap.data() },
    items,
  }
}

function groupItemsByImage(items, labels) {
  const labelSet = new Set(labels)
  const grouped = new Map()
  const skipped = []

  for (const item of items) {
    if (!item.imagePath) {
      skipped.push({ rowId: item.rowId || item.id, reason: 'missing_image_path' })
      continue
    }
    if (!item.problemType || EXCLUDED_LABELS.has(item.problemType)) {
      skipped.push({ rowId: item.rowId || item.id, reason: 'excluded_or_missing_label' })
      continue
    }
    if (!labelSet.has(item.problemType)) {
      skipped.push({
        rowId: item.rowId || item.id,
        reason: 'label_not_in_output_vocabulary',
        problemType: item.problemType,
      })
      continue
    }

    const key = item.imagePath
    if (!grouped.has(key)) {
      grouped.set(key, {
        imagePath: item.imagePath,
        imageUrl: item.imageUrl ?? null,
        bodyPart: item.bodyPart ?? null,
        split: normalizeSplit(item.effectiveSplit, item.imagePath),
        labels: new Set(),
        rowIds: [],
        diagnosisIds: new Set(),
        datasetImageIds: new Set(),
        sourceTypes: new Set(),
        sourceCollections: new Set(),
        sourceDatasets: new Set(),
        originalSplits: new Set(),
        effectiveSplits: new Set(),
        reviewMeta: [],
      })
    }

    const record = grouped.get(key)
    record.labels.add(item.problemType)
    record.rowIds.push(item.rowId || item.id)
    if (item.diagnosisId) record.diagnosisIds.add(item.diagnosisId)
    if (item.datasetImageId) record.datasetImageIds.add(item.datasetImageId)
    if (item.sourceType) record.sourceTypes.add(item.sourceType)
    if (item.sourceCollection) record.sourceCollections.add(item.sourceCollection)
    if (item.sourceDataset) record.sourceDatasets.add(item.sourceDataset)
    if (item.originalSplit) record.originalSplits.add(item.originalSplit)
    if (item.effectiveSplit) record.effectiveSplits.add(item.effectiveSplit)
    record.reviewMeta.push({
      rowId: item.rowId || item.id,
      problemType: item.problemType,
      severity: item.severity ?? null,
      spread: item.spread ?? null,
      expertConfidence: item.expertConfidence ?? null,
      imageQuality: item.imageQuality ?? null,
      reviewedBy: item.reviewedBy ?? null,
      reviewedByName: item.reviewedByName ?? null,
      reviewedAt: timestampValue(item.reviewedAt),
    })
  }

  const records = [...grouped.values()].map((record) => {
    const labelsForImage = enforceHealthyExclusivity(record.labels)
    return {
      image: `images/${record.split}/${safeImageRef(record.imagePath)}`,
      split: record.split,
      bodyPart: record.bodyPart,
      labels: [...labelsForImage].sort((first, second) => labels.indexOf(first) - labels.indexOf(second)),
      target: buildTarget(labelsForImage, labels),
      imagePath: record.imagePath,
      imageUrl: record.imageUrl,
      rowIds: record.rowIds,
      diagnosisIds: [...record.diagnosisIds],
      datasetImageIds: [...record.datasetImageIds],
      sourceTypes: [...record.sourceTypes],
      sourceCollections: [...record.sourceCollections],
      sourceDatasets: [...record.sourceDatasets],
      originalSplits: [...record.originalSplits],
      effectiveSplits: [...record.effectiveSplits],
      reviewMeta: record.reviewMeta,
    }
  })

  return { records, skipped }
}

function summarize(records, labels, skipped, job) {
  const bySplit = Object.fromEntries(SPLITS.map((split) => [split, 0]))
  const byLabel = Object.fromEntries(labels.map((label) => [label, 0]))
  const byLabelAndSplit = Object.fromEntries(
    labels.map((label) => [
      label,
      Object.fromEntries(SPLITS.map((split) => [split, 0])),
    ]),
  )
  const bySourceType = {}
  let multiLabelImages = 0
  let healthyOnlyImages = 0

  for (const record of records) {
    bySplit[record.split] = (bySplit[record.split] ?? 0) + 1
    if (record.labels.length > 1) multiLabelImages += 1
    if (record.labels.length === 1 && record.labels[0] === 'healthy') healthyOnlyImages += 1
    record.labels.forEach((label) => {
      byLabel[label] = (byLabel[label] ?? 0) + 1
      byLabelAndSplit[label][record.split] = (byLabelAndSplit[label][record.split] ?? 0) + 1
    })
    record.sourceTypes.forEach((sourceType) => {
      bySourceType[sourceType] = (bySourceType[sourceType] ?? 0) + 1
    })
  }

  return {
    jobId: job.id,
    targetPart: job.targetPart ?? null,
    exportMode: 'sigmoid_multilabel_metadata_only',
    labels,
    itemRowsRead: Number(job.manifestItemCount) || null,
    imageRecords: records.length,
    skippedRows: skipped.length,
    multiLabelImages,
    healthyOnlyImages,
    bySplit,
    byLabel,
    byLabelAndSplit,
    bySourceType,
    healthyRule: 'healthy is removed when any disease label is present for the same image',
    noImageDownload: true,
    createdAt: new Date().toISOString(),
  }
}

async function writeExport(outDir, { labels, records, skipped, summary, job }) {
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'labels.json'), `${JSON.stringify(labels, null, 2)}\n`)
  await writeFile(
    path.join(outDir, 'manifest.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''),
  )
  await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(
    path.join(outDir, 'skipped_rows.json'),
    `${JSON.stringify(skipped, null, 2)}\n`,
  )
  await writeFile(
    path.join(outDir, 'job.json'),
    `${JSON.stringify({ id: job.id, ...job }, null, 2)}\n`,
  )
  await mkdir(path.join(outDir, 'images', 'train'), { recursive: true })
  await mkdir(path.join(outDir, 'images', 'valid'), { recursive: true })
  await mkdir(path.join(outDir, 'images', 'test'), { recursive: true })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const outDir = path.resolve(options.outDir || path.join(REPO_ROOT, 'training_exports', options.jobId))
  const { job, items } = await loadTrainingJob(options.jobId)
  const labels = normalizeLabels(options.labels || job.selectedLabels || [], job.targetPart)
  const { records, skipped } = groupItemsByImage(items, labels)
  const summary = summarize(records, labels, skipped, job)

  console.log('Sigmoid-ready training export')
  console.log(`Project: ${PROJECT_ID}`)
  console.log(`Training set: ${MODEL_TRAINING_JOBS}/${options.jobId}`)
  console.log(`Rows read: ${items.length}`)
  console.log(`Image records: ${records.length}`)
  console.log(`Labels: ${labels.join(', ')}`)
  console.log(`Output: ${outDir}`)
  console.log('Image download: disabled')

  if (options.dryRun) {
    console.log('\nDry run only. No export files written.')
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  await writeExport(outDir, { labels, records, skipped, summary, job })
  console.log('\nExport files written:')
  console.log(`  ${path.join(outDir, 'labels.json')}`)
  console.log(`  ${path.join(outDir, 'manifest.jsonl')}`)
  console.log(`  ${path.join(outDir, 'summary.json')}`)
  console.log(`  ${path.join(outDir, 'skipped_rows.json')}`)
  console.log(`  ${path.join(outDir, 'job.json')}`)
  console.log('\nNo image files were downloaded. The images/ folders are placeholders for a later downloader/trainer.')
}

main().catch((error) => {
  console.error(`\nTraining export failed: ${error.message}`)
  process.exitCode = 1
})
