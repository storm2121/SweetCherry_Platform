import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import WeatherContextPanel from '../components/WeatherContextPanel.jsx';
import ModelTester from '../components/ModelTester.jsx';
import edgeModelMetadata from '../data/edgeModelFingerprint.json';
import { bundledModelVersion } from '../utils/edgeModelContract.js';
import {
  ADMIN_CONTENT_SECTIONS,
  backfillDailyWeatherCache,
  backfillDiagnosisWeatherContext,
  createModelTrainingJob,
  deleteAdminEntry,
  deleteUser,
  getPendingExperts,
  listDatasetImages,
  listAdminContent,
  listModelCandidates,
  listModelTrainingJobs,
  listUsers,
  publishModelCandidate,
  updateExpertStatus,
} from '../services/adminService.js';
import {
  BODY_PART_OPTIONS,
  DIAGNOSIS_STATUS_META,
  PROBLEM_OPTIONS,
  SEVERITY_OPTIONS,
  optionLabel,
} from '../services/diagnosisConstants.js';
import { fetchForecastMeta, GRADES, uploadForecastExcel } from '../services/forecastService.js';
import { fetchRegistrationOpen, setRegistrationOpen } from '../services/settingsService.js';

const EMPTY_CONTENT = Object.fromEntries(ADMIN_CONTENT_SECTIONS.map((section) => [section.key, []]));
const TRAINING_TARGET_PARTS = ['leaf', 'fruit'];
const DEFAULT_MIN_REVIEWED_COUNT = 20;
const CURRENT_MODEL_VERSION = bundledModelVersion(edgeModelMetadata.fingerprint);
const ADMIN_TABS = [
  { key: 'dashboard', label: 'Dashboard', hint: 'Counts and alerts' },
  { key: 'model', label: 'Model', hint: 'Data and testing' },
  { key: 'manage', label: 'Manage', hint: 'Users and content' },
];
const PART_DISPLAY_LABELS = {
  leaf: 'Leaf',
  fruit: 'Fruit',
  flower: 'Flower',
  bud: 'Bud',
  branch: 'Branch',
  trunk: 'Trunk',
  canopy: 'Canopy',
  root: 'Root',
  other: 'Other',
};
const PROBLEM_DISPLAY_LABELS = {
  healthy: 'Healthy',
  powdery_mildew: 'Powdery mildew',
  brown_spot: 'Brown spot',
  leaf_scorch: 'Leaf scorch',
  purple_leaf_spot: 'Purple leaf spot',
  shot_hole: 'Shot hole',
  fruit_cracking: 'Fruit cracking',
  brown_rot: 'Brown rot',
  pest_damage: 'Pest damage',
  nutrient_deficiency: 'Nutrient deficiency',
  water_stress: 'Water stress',
  heat_frost_damage: 'Heat/frost damage',
  unknown_needs_more_info: 'Needs more info',
  other: 'Other',
};

const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const [pendingExperts, setPendingExperts] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [content, setContent] = useState(EMPTY_CONTENT);
  const [datasetImages, setDatasetImages] = useState([]);
  const [trainingJobs, setTrainingJobs] = useState([]);
  const [modelCandidates, setModelCandidates] = useState([]);
  const [activeSectionKey, setActiveSectionKey] = useState(ADMIN_CONTENT_SECTIONS[0].key);
  const [activeAdminTab, setActiveAdminTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [actionKey, setActionKey] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, users, contentMap, legacyDatasetImages, jobs, candidates] = await Promise.all([
        getPendingExperts(),
        listUsers(),
        listAdminContent(),
        listDatasetImages(),
        listModelTrainingJobs(),
        listModelCandidates(),
      ]);
      setPendingExperts(pending);
      setAllUsers(users);
      setContent({ ...EMPTY_CONTENT, ...contentMap });
      setDatasetImages(legacyDatasetImages);
      setTrainingJobs(jobs);
      setModelCandidates(candidates);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeSection =
    ADMIN_CONTENT_SECTIONS.find((section) => section.key === activeSectionKey) ??
    ADMIN_CONTENT_SECTIONS[0];
  const activeItems = content[activeSection.key] ?? [];
  const datasetRows = useMemo(
    () => buildDatasetRows(content.diagnoses ?? [], datasetImages),
    [content.diagnoses, datasetImages],
  );
  const datasetSummary = useMemo(() => buildDatasetSummary(datasetRows), [datasetRows]);
  const contentItemCount = useMemo(
    () =>
      Object.values(content).reduce(
        (total, items) => total + (Array.isArray(items) ? items.length : 0),
        0,
      ),
    [content],
  );

  const stats = useMemo(() => {
    const diagnoses = content.diagnoses ?? [];
    const expertMedia = content.farmerMessages ?? [];
    const chat = content.farmerChat ?? [];
    return [
      { label: 'Users', value: allUsers.length, hint: 'Registered accounts' },
      { label: 'Pending experts', value: pendingExperts.length, hint: 'Need approval' },
      { label: 'Diagnosis submissions', value: diagnoses.length, hint: 'Plant photo requests' },
      { label: 'Media/messages', value: expertMedia.length + chat.length, hint: 'Farmer communication' },
      { label: 'Reviewed labels', value: datasetRows.length, hint: 'Training-ready labels' },
    ];
  }, [allUsers.length, content, datasetRows.length, pendingExperts.length]);

  const adminTabs = useMemo(
    () =>
      ADMIN_TABS.map((tab) => {
        const countMap = {
          dashboard: pendingExperts.length,
          model: datasetRows.length,
          manage: allUsers.length + contentItemCount,
        };
        return { ...tab, count: countMap[tab.key] ?? 0 };
      }),
    [
      allUsers.length,
      contentItemCount,
      datasetRows.length,
      pendingExperts.length,
    ],
  );
  const statusTone = /error|failed|internal|500|cors|permission|denied/i.test(status) ? 'red' : 'green';

  const handleExpertDecision = async (expertId, decision) => {
    const key = `expert:${expertId}:${decision}`;
    try {
      setActionKey(key);
      setStatus('');
      await updateExpertStatus(expertId, decision);
      await loadData();
      setStatus(decision === 'approved' ? 'تم قبول الخبير.' : 'تم رفض الخبير.');
    } catch (err) {
      setStatus(err.message);
    } finally {
      setActionKey('');
    }
  };

  const handleDeleteUser = async (account) => {
    const protectedAccount = account.id === user?.uid || account.role === 'admin';
    if (protectedAccount) return;

    const confirmed = window.confirm(
      `حذف حساب ${account.name || account.phone}؟ سيتم حذف الحساب من المصادقة وقاعدة البيانات ومحاولة حذف ملفاته ورسائله المرتبطة من Storage.`,
    );
    if (!confirmed) return;

    try {
      setActionKey(`user:${account.id}`);
      setStatus('');
      const result = await deleteUser(account.id);
      await loadData();
      const storageCount = result?.cleanup?.storageFiles ?? 0;
      setStatus(`تم حذف الحساب وتنظيف ${storageCount} ملف/ملفات من التخزين.`);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setActionKey('');
    }
  };

  const handleDeleteRecord = async (section, item) => {
    const title = getRecordTitle(section.key, item);
    const confirmed = window.confirm(
      `حذف "${title}"؟ سيتم حذف المستند من Firestore وحذف الملف المرتبط من Storage إن وجد.`,
    );
    if (!confirmed) return;

    try {
      setActionKey(`${section.collectionName}:${item.id}`);
      setStatus('');
      const result = await deleteAdminEntry({
        collectionName: section.collectionName,
        id: item.id,
      });
      await loadData();
      setStatus(`تم حذف العنصر. ملفات التخزين التي تم تنظيفها: ${result?.storageDeleted ?? 0}.`);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setActionKey('');
    }
  };

  const handleCreateTrainingJob = async ({ targetPart, selectedLabels, minReviewedCount }) => {
    const key = `training:${targetPart}`;
    const manifest = buildTrainingManifest({
      rows: datasetRows,
      targetPart,
      selectedLabels,
      minReviewedCount,
    });

    if (!manifest.items.length) {
      setStatus('No reviewed labels match this training set selection yet.');
      return;
    }

    try {
      setActionKey(key);
      setStatus('');
      const job = await createModelTrainingJob({
        targetPart,
        selectedLabels: manifest.selectedLabels,
        minReviewedCount,
        manifestItems: manifest.items,
        labelCounts: manifest.labelCounts,
        admin: user,
      });
      const jobs = await listModelTrainingJobs();
      setTrainingJobs(jobs);
      setStatus(`Training set ${job.id} created with ${manifest.items.length} reviewed labels.`);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setActionKey('');
    }
  };

  const handlePublishCandidate = async (candidateId) => {
    try {
      setActionKey(`candidate:${candidateId}`);
      setStatus('');
      const result = await publishModelCandidate({ candidateId, admin: user });
      const candidates = await listModelCandidates();
      setModelCandidates(candidates);
      setStatus(`Model registry record published: ${result.modelVersion}. The bundled browser classifier is unchanged.`);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setActionKey('');
    }
  };

  const handleWeatherCacheBackfill = async () => {
    try {
      setActionKey('weather:cache');
      setStatus('');
      const result = await backfillDailyWeatherCache({ days: 90 });
      setStatus(`Weather cache updated: ${result.written ?? 0} region-day records saved.`);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setActionKey('');
    }
  };

  const handleDiagnosisWeatherBackfill = async () => {
    try {
      setActionKey('weather:diagnoses');
      setStatus('');
      const result = await backfillDiagnosisWeatherContext({ limit: 100 });
      setStatus(
        `Diagnosis weather updated: ${result.updated ?? 0} records enriched from ${result.selected ?? 0} selected.`,
      );
      await loadData();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setActionKey('');
    }
  };

  return (
    <main className="min-h-screen bg-[#F7F4EC] px-4 py-4 pb-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="rounded-[1.75rem] bg-[#263222] p-5 text-white shadow-[0_16px_40px_-22px_rgba(38,50,34,0.55)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="mb-2 text-xs font-bold text-[#D7C8A4]">لوحة التحكم العليا</p>
              <h1 className="m-0 font-[Fraunces] text-2xl font-bold">إدارة SweetCherry</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/75">
                راقب الحسابات، تشخيصات الصور، رسائل المزارعين، منشورات الأسعار، وتوجيهات الخبراء من مكان واحد.
              </p>
            </div>
            <button
              className="self-start rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15"
              onClick={logout}
              type="button"
            >
              خروج
            </button>
          </div>
        </header>

        {status ? (
          <p
            className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
              statusTone === 'red'
                ? 'border-[#F2C8C2] bg-[#FDECEC] text-[#A85448]'
                : 'border-[#DCE5D4] bg-[#FEFEFA] text-[#5D7052]'
            }`}
          >
            {status}
          </p>
        ) : null}
        {loading ? (
          <p className="rounded-2xl border border-[#DED8CF] bg-[#FEFEFA] px-4 py-3 text-sm text-[#78786C]">
            جاري تحميل بيانات الإدارة...
          </p>
        ) : null}

        <AdminTabs tabs={adminTabs} activeKey={activeAdminTab} onSelect={setActiveAdminTab} />

        {activeAdminTab === 'dashboard' ? (
          <OverviewSection
            stats={stats}
            pendingExpertCount={pendingExperts.length}
            datasetSummary={datasetSummary}
            trainingJobs={trainingJobs}
            modelCandidates={modelCandidates}
            contentItemCount={contentItemCount}
            status={status}
            statusTone={statusTone}
          />
        ) : null}

        {activeAdminTab === 'model' ? (
          <ModelConsoleSection
            datasetRows={datasetRows}
            datasetSummary={datasetSummary}
            actionKey={actionKey}
            modelCandidates={modelCandidates}
            trainingJobs={trainingJobs}
            onCreateTrainingJob={handleCreateTrainingJob}
            onPublishCandidate={handlePublishCandidate}
          />
        ) : null}

        {activeAdminTab === 'manage' ? (
          <div className="grid gap-4">
            <RegistrationSection adminUid={user?.uid} />
            <WeatherEnrichmentSection
              actionKey={actionKey}
              onBackfillCache={handleWeatherCacheBackfill}
              onBackfillDiagnoses={handleDiagnosisWeatherBackfill}
            />
            <ForecastUploadSection adminUid={user?.uid} />
            <div className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
              <PendingExpertsSection
                experts={pendingExperts}
                actionKey={actionKey}
                onDecision={handleExpertDecision}
              />
              <UsersSection
                users={allUsers}
                currentUserId={user?.uid}
                actionKey={actionKey}
                onDelete={handleDeleteUser}
              />
            </div>
            <ContentManager
              sections={ADMIN_CONTENT_SECTIONS}
              activeSection={activeSection}
              activeItems={activeItems}
              actionKey={actionKey}
              onSelectSection={setActiveSectionKey}
              onDeleteRecord={handleDeleteRecord}
            />
          </div>
        ) : null}

      </div>
    </main>
  );
};

const AdminStat = ({ label, value, hint }) => (
  <section className="rounded-[1.25rem] border border-[#DED8CF]/60 bg-[#FEFEFA] p-4 shadow-[0_8px_22px_-20px_rgba(44,44,36,0.45)]">
    <span className="block text-xs font-bold text-[#78786C]">{label}</span>
    <strong className="mt-1 block font-[Fraunces] text-3xl text-[#2C2C24]">{value}</strong>
    <span className="mt-1 block text-xs text-[#9A8F7F]">{hint}</span>
  </section>
);

const AdminTabs = ({ tabs, activeKey, onSelect }) => (
  <nav className="rounded-[1.35rem] border border-[#DED8CF]/70 bg-[#FEFEFA] p-2 shadow-[0_10px_26px_-24px_rgba(44,44,36,0.45)]">
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {tabs.map((tab) => {
        const active = activeKey === tab.key;
        return (
          <button
            key={tab.key}
            className={`rounded-[1rem] border px-4 py-3 text-left transition ${
              active
                ? 'border-[#5D7052] bg-[#EEF2EA] text-[#2C2C24]'
                : 'border-transparent bg-transparent text-[#78786C] hover:bg-[#F7F4EC]'
            }`}
            type="button"
            onClick={() => onSelect(tab.key)}
          >
            <span className="flex items-center justify-between gap-2">
              <strong className="text-sm">{tab.label}</strong>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  active ? 'bg-white text-[#5D7052]' : 'bg-[#F7F4EC] text-[#8A7E6D]'
                }`}
              >
                {tab.count}
              </span>
            </span>
            <span className="mt-1 block text-xs opacity-80">{tab.hint}</span>
          </button>
        );
      })}
    </div>
  </nav>
);

const OverviewSection = ({
  stats,
  pendingExpertCount,
  datasetSummary,
  trainingJobs,
  modelCandidates,
  contentItemCount,
  status,
  statusTone,
}) => {
  const latestTrainingSet = trainingJobs[0];
  const publishedModel = modelCandidates.find((candidate) => candidate.status === 'published');
  const hasErrorStatus = status && statusTone === 'red';

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {stats.map((item) => (
          <AdminStat key={item.label} {...item} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[1.5rem] border border-[#DED8CF]/60 bg-[#FEFEFA] p-5 shadow-[0_8px_24px_-22px_rgba(44,44,36,0.45)]">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[#8A7E6D]">Needs Attention</p>
              <h2 className="m-0 mt-1 font-[Fraunces] text-xl font-bold text-[#2C2C24]">Admin alerts</h2>
            </div>
            <Badge text={pendingExpertCount || hasErrorStatus ? 'action needed' : 'clear'} tone={pendingExpertCount || hasErrorStatus ? 'amber' : 'green'} />
          </div>

          <div className="grid gap-2">
            {pendingExpertCount ? (
              <AlertRow
                title={`${pendingExpertCount} expert account${pendingExpertCount === 1 ? '' : 's'} waiting`}
                body="Review them from the Manage tab before they can use the expert dashboard."
                tone="amber"
              />
            ) : null}
            {hasErrorStatus ? (
              <AlertRow
                title="Recent admin action failed"
                body={status}
                tone="red"
              />
            ) : null}
            {!pendingExpertCount && !hasErrorStatus ? (
              <AlertRow
                title="No urgent admin alerts"
                body="User approvals, content records, and model data are visible from the task tabs."
                tone="green"
              />
            ) : null}
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-[#DED8CF]/60 bg-[#FEFEFA] p-5 shadow-[0_8px_24px_-22px_rgba(44,44,36,0.45)]">
          <div className="mb-4">
            <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[#8A7E6D]">Model Status</p>
            <h2 className="m-0 mt-1 font-[Fraunces] text-xl font-bold text-[#2C2C24]">Simple model overview</h2>
            <p className="m-0 mt-2 text-sm leading-relaxed text-[#78786C]">
              Use the Model tab to prepare reviewed images for training and test the current model.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <WorkflowStep number="1" title="Reviewed images" body={`${datasetSummary.uniqueImages} images available.`} />
            <WorkflowStep number="2" title="Reviewed labels" body={`${datasetSummary.totalRows} expert labels available.`} />
            <WorkflowStep number="3" title="Prepared sets" body={latestTrainingSet ? `${trainingJobs.length} saved set${trainingJobs.length === 1 ? '' : 's'}.` : 'No saved sets yet.'} />
            <WorkflowStep number="4" title="Current model" body={publishedModel ? `${publishedModel.modelVersion || publishedModel.id} is registered. The bundled classifier is tested separately.` : 'Using the bundled classifier; no registry record is published.'} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge text={`${datasetSummary.uniqueImages} reviewed images`} tone="blue" />
            <Badge text={`${contentItemCount} content records`} tone="green" />
            <Badge text={CURRENT_MODEL_VERSION} tone="amber" />
          </div>
        </section>
      </div>
    </div>
  );
};

const AlertRow = ({ title, body, tone = 'amber' }) => (
  <div className={`rounded-[1rem] border p-3 ${tone === 'red' ? 'border-[#F2C8C2] bg-[#FDECEC]' : tone === 'green' ? 'border-[#DCE5D4] bg-[#EEF2EA]' : 'border-[#F6E4AD] bg-[#FFF6D8]'}`}>
    <h3 className="m-0 text-sm font-bold text-[#2C2C24]">{title}</h3>
    <p className="m-0 mt-1 text-xs leading-relaxed text-[#78786C]">{body}</p>
  </div>
);

const WorkflowStep = ({ number, title, body }) => (
  <div className="rounded-[1rem] border border-[#DED8CF]/60 bg-[#FDFCF8] p-3">
    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#263222] text-xs font-bold text-white">{number}</span>
    <h3 className="m-0 mt-3 text-sm font-bold text-[#2C2C24]">{title}</h3>
    <p className="m-0 mt-1 text-xs leading-relaxed text-[#78786C]">{body}</p>
  </div>
);

const PendingExpertsSection = ({ experts, actionKey, onDecision }) => (
  <section className="rounded-[1.5rem] border border-[#DED8CF]/50 bg-[#FEFEFA] p-4 shadow-[0_8px_24px_-22px_rgba(44,44,36,0.45)]">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div>
        <h2 className="m-0 font-[Fraunces] text-lg font-bold text-[#2C2C24]">خبراء بانتظار التحقق</h2>
        <p className="mt-1 text-xs text-[#78786C]">قبول أو رفض حسابات الخبراء قبل دخولهم للوحة المراجعة.</p>
      </div>
      <span className="rounded-full bg-[#FFF6D8] px-3 py-1 text-xs font-bold text-[#8A5A00]">{experts.length}</span>
    </div>
    {!experts.length ? <EmptyText text="لا توجد ملفات خبراء قيد المراجعة." /> : null}
    <div className="grid gap-2.5">
      {experts.map((expert) => (
        <article key={expert.id} className="rounded-[1rem] border border-[#DED8CF]/50 bg-[#FDFCF8] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="m-0 truncate text-sm font-bold text-[#2C2C24]">{expert.name}</h3>
              <p className="mt-1 text-xs text-[#78786C]">
                {expert.phone} • {expert.status}
              </p>
            </div>
            {expert.documentUrl ? (
              <a className="shrink-0 text-xs font-bold text-[#5D7052] underline" href={expert.documentUrl} target="_blank" rel="noreferrer">
                المستند
              </a>
            ) : (
              <span className="shrink-0 text-xs text-[#9A8F7F]">لا مستند</span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ActionButton
              label="قبول"
              tone="green"
              disabled={!!actionKey}
              loading={actionKey === `expert:${expert.id}:approved`}
              onClick={() => onDecision(expert.id, 'approved')}
            />
            <ActionButton
              label="رفض"
              tone="red"
              disabled={!!actionKey}
              loading={actionKey === `expert:${expert.id}:rejected`}
              onClick={() => onDecision(expert.id, 'rejected')}
            />
          </div>
        </article>
      ))}
    </div>
  </section>
);

const UsersSection = ({ users, currentUserId, actionKey, onDelete }) => (
  <section className="rounded-[1.5rem] border border-[#DED8CF]/50 bg-[#FEFEFA] p-4 shadow-[0_8px_24px_-22px_rgba(44,44,36,0.45)]">
    <div className="mb-3">
      <h2 className="m-0 font-[Fraunces] text-lg font-bold text-[#2C2C24]">كل المستخدمين</h2>
      <p className="mt-1 text-xs text-[#78786C]">حذف المستخدم يحاول تنظيف حساب المصادقة، ملف المستخدم، وملفاته المرتبطة.</p>
    </div>
    <div className="max-h-[420px] overflow-y-auto pr-1">
      <div className="grid gap-2.5">
        {users.map((account) => {
          const protectedAccount = account.id === currentUserId || account.role === 'admin';
          return (
            <article
              key={account.id}
              className="grid gap-3 rounded-[1rem] border border-[#DED8CF]/50 bg-[#FDFCF8] p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <h3 className="m-0 truncate text-sm font-bold text-[#2C2C24]">{account.name || 'بدون اسم'}</h3>
                <p className="mt-1 text-xs text-[#78786C]">
                  {roleLabel(account.role)} • {account.phone || 'لا هاتف'} {account.city ? `• ${account.city}` : ''}
                </p>
                <p className="mt-1 truncate text-[11px] text-[#9A8F7F]">{account.id}</p>
              </div>
              <ActionButton
                label={protectedAccount ? 'محمي' : 'حذف الحساب'}
                tone="red"
                disabled={protectedAccount || !!actionKey}
                loading={actionKey === `user:${account.id}`}
                onClick={() => onDelete(account)}
              />
            </article>
          );
        })}
      </div>
    </div>
  </section>
);

const ContentManager = ({
  sections,
  activeSection,
  activeItems,
  actionKey,
  onSelectSection,
  onDeleteRecord,
}) => (
  <section className="rounded-[1.5rem] border border-[#DED8CF]/50 bg-[#FEFEFA] p-4 shadow-[0_8px_24px_-22px_rgba(44,44,36,0.45)]">
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 className="m-0 font-[Fraunces] text-xl font-bold text-[#2C2C24]">إدارة محتوى الموقع</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#78786C]">
          افتح أي قسم، راجع العناصر، واحذف المستند مع ملف التخزين المرتبط عند وجوده.
        </p>
      </div>
      <span className="self-start rounded-full bg-[#EEF2EA] px-3 py-1.5 text-xs font-bold text-[#5D7052]">
        {activeItems.length} عنصر
      </span>
    </div>

    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {sections.map((section) => (
        <button
          key={section.key}
          className={`shrink-0 rounded-full border px-3 py-2 text-xs font-bold transition ${
            activeSection.key === section.key
              ? 'border-[#5D7052] bg-[#5D7052] text-white'
              : 'border-[#DED8CF] bg-[#FDFCF8] text-[#2C2C24] hover:border-[#5D7052]/40'
          }`}
          type="button"
          onClick={() => onSelectSection(section.key)}
        >
          {section.label}
        </button>
      ))}
    </div>

    <div className="mb-3 rounded-[1rem] bg-[#F7F4EC] px-4 py-3">
      <h3 className="m-0 text-sm font-bold text-[#2C2C24]">{activeSection.label}</h3>
      <p className="mt-1 text-xs text-[#78786C]">{activeSection.description}</p>
    </div>

    {!activeItems.length ? <EmptyText text="لا توجد عناصر في هذا القسم." /> : null}
    <div className="grid gap-3 lg:grid-cols-2">
      {activeItems.map((item) => (
        <ContentRecordCard
          key={`${activeSection.collectionName}:${item.id}`}
          section={activeSection}
          item={item}
          busy={actionKey === `${activeSection.collectionName}:${item.id}`}
          disabled={!!actionKey}
          onDelete={() => onDeleteRecord(activeSection, item)}
        />
      ))}
    </div>
  </section>
);

const ContentRecordCard = ({ section, item, busy, disabled, onDelete }) => {
  const meta = getRecordMeta(section.key, item);
  return (
    <article className="overflow-hidden rounded-[1.25rem] border border-[#DED8CF]/50 bg-[#FDFCF8]">
      {meta.preview ? meta.preview : null}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m-0 truncate text-sm font-bold text-[#2C2C24]">{meta.title}</h3>
            <p className="mt-1 text-xs text-[#78786C]">{meta.subtitle}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.badgeClass}`}>
            {meta.badge}
          </span>
        </div>

        {meta.body ? <p className="mt-3 text-sm leading-relaxed text-[#2C2C24]">{meta.body}</p> : null}
        {meta.details.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {meta.details.map((detail) => (
              <span key={detail} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#78786C]">
                {detail}
              </span>
            ))}
          </div>
        ) : null}
        {meta.showWeatherContext ? <WeatherContextPanel diagnosis={item} compact /> : null}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#DED8CF]/50 pt-3">
          <span className="min-w-0 truncate font-mono text-[10px] text-[#9A8F7F]">{section.collectionName}/{item.id}</span>
          <ActionButton
            label="حذف"
            tone="red"
            disabled={disabled}
            loading={busy}
            onClick={onDelete}
          />
        </div>
      </div>
    </article>
  );
};

// Opens or pauses registration for new farmers and experts. The sign-up page
// and the security rules both read settings/registration.
const RegistrationSection = ({ adminUid }) => {
  const [open, setOpen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetchRegistrationOpen()
      .then((value) => active && setOpen(value))
      .catch(() => active && setOpen(false));
    return () => {
      active = false;
    };
  }, []);

  const toggle = async () => {
    if (open === null || saving) return;
    const next = !open;
    if (!window.confirm(next ? 'فتح التسجيل للمزارعين والخبراء الجدد؟' : 'إيقاف التسجيل حتى الدفعة القادمة؟')) return;
    setSaving(true);
    setError('');
    try {
      await setRegistrationOpen(next, adminUid);
      setOpen(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  let description = 'جارٍ التحقق من حالة التسجيل…';
  if (open === true) description = 'التسجيل مفتوح: يمكن للمزارعين والخبراء الجدد إنشاء حسابات.';
  if (open === false) description = 'التسجيل متوقف: صفحة التسجيل تخبر الزوار أن التسجيل سيُفتح مع الدفعة القادمة. الحسابات الحالية تعمل كالمعتاد.';

  return (
    <section className="rounded-[1.5rem] border border-[#DED8CF]/60 bg-[#FEFEFA] p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="m-0 font-[Fraunces] text-lg font-bold text-[#2C2C24]">التسجيل في المنصة</h2>
          <p className="mt-1 text-sm text-[#78786C]">{description}</p>
          {error ? <p role="alert" className="mt-2 text-sm font-bold text-[#A85448]">{error}</p> : null}
        </div>
        <div className="md:w-48">
          <ActionButton
            label={open ? 'إيقاف التسجيل' : 'فتح التسجيل'}
            tone={open ? 'red' : 'green'}
            disabled={open === null || saving}
            loading={saving}
            onClick={toggle}
          />
        </div>
      </div>
    </section>
  );
};

const ActionButton = ({ label, tone = 'green', disabled = false, loading = false, onClick }) => {
  const toneClass =
    tone === 'red'
      ? 'bg-[#A85448] text-white hover:bg-[#93473d]'
      : 'bg-[#5D7052] text-white hover:bg-[#4f6046]';
  return (
    <button
      className={`rounded-full px-4 py-2 text-xs font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? 'جاري...' : label}
    </button>
  );
};

const EmptyText = ({ text }) => (
  <p className="rounded-[1rem] border border-dashed border-[#DED8CF] bg-[#FDFCF8] px-4 py-5 text-center text-sm text-[#78786C]">
    {text}
  </p>
);

const WeatherEnrichmentSection = ({ actionKey, onBackfillCache, onBackfillDiagnoses }) => (
  <section className="rounded-[1.5rem] border border-[#DED8CF]/60 bg-[#FEFEFA] p-5 shadow-[0_8px_24px_-22px_rgba(44,44,36,0.45)]">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge text="Weather enrichment" tone="blue" />
          <Badge text="Admin only" tone="amber" />
        </div>
        <h2 className="m-0 font-[Fraunces] text-xl font-bold text-[#2C2C24]">Diagnosis weather context</h2>
        <p className="m-0 mt-2 max-w-3xl text-sm leading-relaxed text-[#78786C]">
          Save recent daily weather for each growing region, then attach those weather patterns to diagnosis photos.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton
          label="Update weather cache"
          loading={actionKey === 'weather:cache'}
          disabled={Boolean(actionKey)}
          onClick={onBackfillCache}
        />
        <ActionButton
          label="Enrich diagnoses"
          loading={actionKey === 'weather:diagnoses'}
          disabled={Boolean(actionKey)}
          onClick={onBackfillDiagnoses}
        />
      </div>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <WorkflowStep number="1" title="Cache weather" body="Stores daily temperature, humidity, rain, and wind by region." />
      <WorkflowStep number="2" title="Attach to photos" body="Adds recent weather context to diagnosis records." />
      <WorkflowStep number="3" title="Use later" body="Supports future disease-risk analysis and model features." />
    </div>
  </section>
);

const ModelConsoleSection = ({
  datasetRows,
  datasetSummary,
  trainingJobs,
  modelCandidates,
  actionKey,
  onCreateTrainingJob,
  onPublishCandidate,
}) => {
  const publishedModel = modelCandidates.find((candidate) => candidate.status === 'published');
  const readyLabels = datasetRows.filter((row) => row.trainable).length;

  return (
    <div className="grid gap-4">
      <section className="rounded-[1.5rem] border border-[#DED8CF]/60 bg-[#FEFEFA] p-5 shadow-[0_18px_46px_-38px_rgba(44,44,36,0.55)]">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="m-0 font-[Fraunces] text-2xl font-bold text-[#2C2C24]">Model data</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#78786C]">
              Pick a plant part and prepare its reviewed images for manual model training. Uploaded datasets and expert reviews are combined here.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniMetric label="Images" value={datasetSummary.uniqueImages} />
            <MiniMetric label="Labels" value={datasetSummary.totalRows} />
            <MiniMetric label="Ready" value={readyLabels} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {BODY_PART_OPTIONS.map((partOption) => (
            <ModelPartCard
              key={partOption.value}
              actionKey={actionKey}
              bucket={datasetSummary.partsByKey.get(partOption.value)}
              part={partOption.value}
              onCreateTrainingJob={onCreateTrainingJob}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
        <ActiveModelPanel publishedModel={publishedModel} />
        <ModelTester />
      </div>

      <AdvancedTrainingDetails
        actionKey={actionKey}
        modelCandidates={modelCandidates}
        trainingJobs={trainingJobs}
        onPublishCandidate={onPublishCandidate}
      />
    </div>
  );
};

const ModelPartCard = ({ part, bucket, actionKey, onCreateTrainingJob }) => {
  const problems = bucket?.problems ?? [];
  const topProblems = problems.filter((problem) => problem.total > 0).slice(0, 4);
  const readyProblems = problems.filter(
    (problem) => problem.isTrainable && problem.trainableCount >= DEFAULT_MIN_REVIEWED_COUNT,
  );
  const hasData = Boolean(bucket?.total);
  const isReady = readyProblems.length > 0;
  const status = !hasData
    ? { label: 'No data', tone: 'amber' }
    : isReady
      ? { label: 'Ready', tone: 'green' }
      : { label: 'Needs more data', tone: 'amber' };
  const isLeaf = part === 'leaf';
  const actionBusy = actionKey === `training:${part}`;

  return (
    <article
      className={`rounded-[1.25rem] border p-4 shadow-[0_12px_28px_-26px_rgba(44,44,36,0.45)] ${
        isLeaf
          ? 'border-[#5D7052]/70 bg-[#F4F8F0]'
          : 'border-[#DED8CF]/60 bg-[#FDFCF8]'
      }`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 font-[Fraunces] text-xl font-bold text-[#2C2C24]">
            {partDisplayName(part)}
          </h3>
          <p className="m-0 mt-1 text-xs text-[#78786C]">
            {isLeaf ? 'Main model target' : 'Prepared for future labels'}
          </p>
        </div>
        <Badge text={status.label} tone={status.tone} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniMetric label="Images" value={bucket?.uniqueImages ?? 0} />
        <MiniMetric label="Labels" value={bucket?.total ?? 0} />
        <MiniMetric label="Ready" value={bucket?.trainableCount ?? 0} />
      </div>

      <div className="mt-4 min-h-[64px]">
        <p className="m-0 mb-2 text-xs font-bold uppercase tracking-[0.06em] text-[#8A7E6D]">
          Top problems
        </p>
        {topProblems.length ? (
          <div className="flex flex-wrap gap-1.5">
            {topProblems.map((problem) => (
              <Badge
                key={problem.problemType}
                text={`${problemDisplayName(problem.problemType)} ${problem.total}`}
                tone={problem.isTrainable ? 'blue' : 'amber'}
              />
            ))}
          </div>
        ) : (
          <p className="m-0 rounded-[0.85rem] border border-dashed border-[#DED8CF] bg-white px-3 py-2 text-xs text-[#78786C]">
            No reviewed labels yet.
          </p>
        )}
      </div>

      {hasData ? (
        <button
          className={`mt-4 w-full rounded-full px-4 py-2.5 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 ${
            isReady ? 'bg-[#5D7052] text-white hover:bg-[#4f6046]' : 'bg-[#DED8CF] text-[#78786C]'
          }`}
          disabled={!isReady || !!actionKey}
          type="button"
          onClick={() =>
            onCreateTrainingJob({
              targetPart: part,
              selectedLabels: readyProblems.map((problem) => problem.problemType),
              minReviewedCount: DEFAULT_MIN_REVIEWED_COUNT,
            })
          }
        >
          {actionBusy ? 'Preparing...' : isReady ? 'Prepare training set' : 'Needs more data'}
        </button>
      ) : null}
    </article>
  );
};

const ModelDatasetSection = ({
  datasetRows,
  datasetSummary,
  actionKey,
  onCreateTrainingJob,
}) => {
  const [activePart, setActivePart] = useState('');
  const [activeProblem, setActiveProblem] = useState('');
  const [folderSearch, setFolderSearch] = useState('');
  const [minReviewedCount, setMinReviewedCount] = useState(DEFAULT_MIN_REVIEWED_COUNT);
  const partBuckets = datasetSummary.parts;
  const selectedPart = datasetSummary.partsByKey.get(activePart) ? activePart : '';
  const selectedPartBucket = selectedPart ? datasetSummary.partsByKey.get(selectedPart) : null;
  const problemBuckets = selectedPartBucket?.problems ?? [];
  const selectedProblem = problemBuckets.some((problem) => problem.problemType === activeProblem)
    ? activeProblem
    : '';
  const selectedFolder = selectedProblem
    ? problemBuckets.find((problem) => problem.problemType === selectedProblem)
    : null;
  const selectedFolderRows = selectedFolder
    ? datasetRows
      .filter((row) => row.bodyPart === selectedPart && row.problemType === selectedProblem)
    : [];
  const previewRows = selectedFolderRows.slice(0, 12);
  const searchTerm = folderSearch.trim().toLowerCase();
  const visiblePartFolders = partBuckets.filter((part) => {
    if (!searchTerm) return true;
    return part.partLabel.toLowerCase().includes(searchTerm) || part.part.toLowerCase().includes(searchTerm);
  });
  const visibleProblemFolders = problemBuckets.filter((problem) => {
    if (!searchTerm) return true;
    return (
      problem.problemLabel.toLowerCase().includes(searchTerm) ||
      problem.problemType.toLowerCase().includes(searchTerm)
    );
  });
  const trainableRows = datasetRows.filter((row) => row.trainable).length;
  const populatedFolderCount = partBuckets.reduce(
    (total, part) => total + part.problems.filter((problem) => problem.total > 0).length,
    0,
  );
  const manifestActionKey = `training:${selectedPart}`;
  const previewTitle = selectedFolder
    ? selectedFolder.problemLabel
    : selectedPartBucket
      ? selectedPartBucket.partLabel
      : 'Dataset overview';
  const previewSubtitle = selectedFolder
    ? `${optionLabel(BODY_PART_OPTIONS, selectedPart)} / ${selectedFolder.problemLabel}`
    : selectedPartBucket
      ? 'Select a problem folder to preview matching reviewed images.'
      : 'Open a plant-part folder to inspect labels and create training sets.';
  const topProblems = (selectedPartBucket?.problems ?? []).filter((problem) => problem.total > 0).slice(0, 6);
  const folderCount = selectedPart ? visibleProblemFolders.length : visiblePartFolders.length;
  const folderCountLabel = selectedPart ? 'problem folders' : 'plant part folders';
  const canCreateManifest =
    TRAINING_TARGET_PARTS.includes(selectedPart) &&
    selectedFolder?.isTrainable &&
    selectedFolder.trainableCount >= minReviewedCount;
  const manifestDisabledReason = !selectedFolder
    ? 'Select a diagnosis folder first.'
    : !TRAINING_TARGET_PARTS.includes(selectedPart)
      ? 'Training targets are limited to leaf and fruit for now.'
      : !selectedFolder.isTrainable
        ? 'This folder is review-only and excluded from training.'
        : selectedFolder.trainableCount < minReviewedCount
          ? `Needs ${minReviewedCount} reviewed labels.`
          : 'Ready for training set creation.';

  const openPart = (part) => {
    setActivePart(part.part);
    setActiveProblem('');
    setFolderSearch('');
  };

  const openProblem = (problem) => {
    setActiveProblem(problem.problemType);
    setFolderSearch('');
  };

  return (
    <section className="rounded-[1.5rem] border border-[#DED8CF]/60 bg-[#FEFEFA] p-5 shadow-[0_18px_46px_-38px_rgba(44,44,36,0.55)]">
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[#5D7052]">Dataset</p>
          <h2 className="m-0 mt-1 font-[Fraunces] text-2xl font-bold text-[#2C2C24]">Reviewed image folders</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#78786C]">
            Choose a plant part, choose a problem, then preview reviewed images. Counts are reviewed labels, so one photo can correctly appear in more than one folder.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniMetric label="Reviewed labels" value={datasetSummary.totalRows} />
          <MiniMetric label="Reviewed images" value={datasetSummary.uniqueImages} />
          <MiniMetric label="Ready labels" value={trainableRows} />
          <MiniMetric label="Folders with data" value={populatedFolderCount} />
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.25rem] border border-[#DED8CF]/70 bg-[#F8F5EC]">
        <div className="border-b border-[#DED8CF]/70 bg-[#FEFEFA] px-4 py-3">
          <div className="grid gap-2 md:grid-cols-3">
            <DatasetStep active number="1" title="Choose plant part" />
            <DatasetStep active={Boolean(selectedPart)} number="2" title="Choose problem" />
            <DatasetStep active={Boolean(selectedFolder)} number="3" title="Preview reviewed images" />
          </div>
        </div>
          <div className="border-b border-[#DED8CF]/70 bg-[#FEFEFA] px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="m-0 text-base font-bold text-[#2C2C24]">Dataset folders</h3>
                <p className="m-0 mt-1 text-xs text-[#78786C]">
                  {folderCount} {folderCountLabel} visible
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    !selectedPart ? 'bg-[#263222] text-white' : 'bg-white text-[#5D7052] hover:bg-[#EEF2EA]'
                  }`}
                  type="button"
                  onClick={() => {
                    setActivePart('');
                    setActiveProblem('');
                    setFolderSearch('');
                  }}
                >
                  All parts
                </button>
                {selectedPartBucket ? (
                  <button
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      selectedPart && !selectedProblem
                        ? 'bg-[#263222] text-white'
                        : 'bg-white text-[#5D7052] hover:bg-[#EEF2EA]'
                    }`}
                    type="button"
                    onClick={() => {
                      setActiveProblem('');
                      setFolderSearch('');
                    }}
                  >
                    {selectedPartBucket.partLabel}
                  </button>
                ) : null}
                {selectedFolder ? <Badge text={selectedFolder.problemLabel} tone="green" /> : null}
              </div>
            </div>
          </div>

          <div className="grid min-h-[560px] lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="border-b border-[#DED8CF]/70 bg-[#FCFAF5] p-3 lg:border-b-0 lg:border-l">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[#8A7E6D]">
                    {selectedPart ? 'Problem folders' : 'Plant part folders'}
                  </p>
                  <p className="m-0 mt-1 text-xs text-[#78786C]">
                    {selectedPart ? selectedPartBucket?.partLabel : 'Reviewed dataset roots'}
                  </p>
                </div>
                {selectedPart ? (
                  <button
                    className="rounded-full border border-[#DED8CF] bg-white px-3 py-1.5 text-xs font-bold text-[#5D7052] transition hover:bg-[#EEF2EA]"
                    type="button"
                    onClick={() => {
                      setActivePart('');
                      setActiveProblem('');
                      setFolderSearch('');
                    }}
                  >
                    Back
                  </button>
                ) : null}
              </div>

              <label className="mb-3 block">
                <span className="sr-only">Search folders</span>
                <input
                  className="w-full rounded-[0.85rem] border border-[#DED8CF] bg-white px-3 py-2 text-sm text-[#2C2C24] outline-none transition placeholder:text-[#A39A8E] focus:border-[#5D7052] focus:ring-2 focus:ring-[#5D7052]/15"
                  type="search"
                  value={folderSearch}
                  placeholder={selectedPart ? 'Search problem folders' : 'Search plant part folders'}
                  onChange={(event) => setFolderSearch(event.target.value)}
                />
              </label>

              <div className="grid max-h-[445px] gap-2 overflow-y-auto pr-1">
                {!selectedPart && !visiblePartFolders.length ? (
                  <EmptyText text="No plant-part folders match this search." />
                ) : null}
                {selectedPart && !visibleProblemFolders.length ? (
                  <EmptyText text="No problem folders match this search." />
                ) : null}
                {!selectedPart
                  ? visiblePartFolders.map((part) => (
                    <ExplorerFolderRow
                      key={part.part}
                      active={selectedPart === part.part}
                      count={part.total}
                      detail={`${part.uniqueImages} images`}
                      label={part.partLabel}
                      status={folderReadiness(part, minReviewedCount)}
                      subtitle={`${part.problems.length} problem folders`}
                      trainableCount={part.trainableCount}
                      onClick={() => openPart(part)}
                    />
                  ))
                  : visibleProblemFolders.map((problem) => (
                    <ExplorerFolderRow
                      key={problem.problemType}
                      active={selectedProblem === problem.problemType}
                      count={problem.total}
                      detail={`${problem.uniqueImages} images`}
                      label={problem.problemLabel}
                      muted={!problem.total}
                      status={folderReadiness(problem, minReviewedCount)}
                      subtitle={problem.isTrainable ? 'usable for training' : 'review only'}
                      trainableCount={problem.trainableCount}
                      onClick={() => openProblem(problem)}
                    />
                  ))}
              </div>
            </aside>

            <div className="bg-[#FEFEFA] p-4">
              <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[#5D7052]">Preview</p>
                  <h3 className="m-0 mt-1 font-[Fraunces] text-xl font-bold text-[#2C2C24]">{previewTitle}</h3>
                  <p className="m-0 mt-1 text-sm text-[#78786C]">{previewSubtitle}</p>
                </div>

                {selectedFolder ? (
                  <div className="grid gap-2 xl:justify-items-end">
                    <ActionButton
                      label={actionKey === manifestActionKey ? 'Creating...' : 'Create training set'}
                      disabled={!canCreateManifest || !!actionKey}
                      loading={actionKey === manifestActionKey}
                      onClick={() =>
                        onCreateTrainingJob({
                          targetPart: selectedPart,
                          selectedLabels: [selectedProblem],
                          minReviewedCount,
                        })
                      }
                    />
                    <details className="text-xs text-[#78786C]">
                      <summary className="cursor-pointer font-bold text-[#5D7052]">Training settings</summary>
                      <label className="mt-2 flex items-center gap-2 rounded-full border border-[#DED8CF] bg-white py-1 pl-3 pr-1 font-bold">
                        Minimum reviewed labels
                        <input
                          className="w-16 rounded-full border border-[#DED8CF] bg-[#FDFCF8] px-2 py-1 text-center text-sm text-[#2C2C24] outline-none focus:border-[#5D7052]"
                          min="1"
                          type="number"
                          value={minReviewedCount}
                          onChange={(event) => setMinReviewedCount(Number(event.target.value) || 1)}
                        />
                      </label>
                    </details>
                  </div>
                ) : null}
              </div>

              {!selectedPart ? (
                <DatasetOverview parts={partBuckets} totalRows={datasetSummary.totalRows} />
              ) : !selectedFolder ? (
                <PartOverview bucket={selectedPartBucket} topProblems={topProblems} onOpenProblem={openProblem} />
              ) : (
                <>
                  <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <FolderStat label="Reviewed labels" value={selectedFolder.total} />
                    <FolderStat label="Reviewed images" value={selectedFolder.uniqueImages} />
                    <FolderStat label="Ready for training" value={selectedFolder.trainableCount} />
                    <FolderStat label="Goal" value={minReviewedCount} />
                  </div>

                  <div className="mb-4 flex flex-wrap gap-2">
                    <Badge
                      text={canCreateManifest ? 'ready for training' : manifestDisabledReason}
                      tone={canCreateManifest ? 'green' : 'amber'}
                    />
                    <Badge text={`${selectedFolderRows.length} matching reviewed labels`} tone="blue" />
                    {selectedFolderRows.length > previewRows.length ? (
                      <Badge text={`showing first ${previewRows.length}`} tone="amber" />
                    ) : null}
                  </div>

                  {!previewRows.length ? <EmptyText text="This dataset folder is empty for now." /> : null}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {previewRows.map((row) => (
                      <article key={row.rowId} className="overflow-hidden rounded-[1rem] border border-[#DED8CF]/60 bg-white shadow-[0_12px_28px_-26px_rgba(44,44,36,0.45)]">
                        {row.imageUrl ? (
                          <img src={row.imageUrl} alt={row.problemLabel} className="h-36 w-full bg-[#DED8CF] object-cover" loading="lazy" />
                        ) : (
                          <div className="grid h-36 place-items-center bg-[#DED8CF] text-xs text-[#78786C]">No image</div>
                        )}
                        <div className="p-3">
                          <p className="m-0 truncate text-sm font-bold text-[#2C2C24]">{row.farmerName}</p>
                          <p className="m-0 mt-1 text-xs text-[#78786C]">{formatTimestamp(row.createdAt)}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {row.severity ? <Badge text={optionLabel(SEVERITY_OPTIONS, row.severity)} tone="amber" /> : null}
                            {row.confidence ? <Badge text={row.confidence} tone="blue" /> : null}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
      </div>
    </section>
  );
};

const DatasetStep = ({ active = false, number, title }) => (
  <div
    className={`rounded-[0.95rem] border px-3 py-2 ${
      active ? 'border-[#5D7052]/45 bg-[#EEF2EA]' : 'border-[#DED8CF]/70 bg-[#FDFCF8]'
    }`}
  >
    <span className="flex items-center gap-2">
      <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${active ? 'bg-[#5D7052] text-white' : 'bg-[#E7E0D6] text-[#78786C]'}`}>
        {number}
      </span>
      <strong className={`text-xs ${active ? 'text-[#2C2C24]' : 'text-[#78786C]'}`}>{title}</strong>
    </span>
  </div>
);

const ExplorerFolderRow = ({
  active = false,
  count,
  detail,
  label,
  muted = false,
  status,
  subtitle,
  trainableCount,
  onClick,
}) => (
  <button
    className={`group flex w-full items-center gap-3 rounded-[0.95rem] border p-3 text-left transition ${
      active
        ? 'border-[#5D7052] bg-[#EEF2EA] shadow-[0_10px_24px_-22px_rgba(44,44,36,0.55)]'
        : muted
          ? 'border-[#E7E0D6] bg-white/60 hover:border-[#C8BDAE]'
          : 'border-[#DED8CF] bg-white hover:border-[#5D7052]/50 hover:bg-[#FFFDF8]'
    }`}
    type="button"
    onClick={onClick}
  >
    <FolderIcon active={active} muted={muted} />
    <span className="min-w-0 flex-1">
      <strong className={`block truncate text-sm ${muted ? 'text-[#78786C]' : 'text-[#2C2C24]'}`}>{label}</strong>
      <span className="mt-0.5 block truncate text-xs text-[#78786C]">{subtitle}</span>
      <span className="mt-2 flex flex-wrap gap-1.5">
        <Badge text={`${count} reviewed`} tone={count ? 'green' : 'amber'} />
        <Badge text={`${trainableCount} ready`} tone={trainableCount ? 'blue' : 'amber'} />
        {status ? <Badge text={status.label} tone={status.tone} /> : null}
      </span>
    </span>
    <span className="hidden max-w-20 truncate text-right text-[11px] font-bold text-[#9A8F7F] sm:block">
      {detail}
    </span>
  </button>
);

const FolderIcon = ({ active = false, muted = false }) => (
  <span
    className={`relative h-9 w-11 shrink-0 rounded-b-[0.55rem] rounded-t-[0.35rem] border ${
      active
        ? 'border-[#5D7052] bg-[#DDE7D6]'
        : muted
          ? 'border-[#DED8CF] bg-[#EEE7DB]'
          : 'border-[#CDBF9C] bg-[#D9CAA7]'
    }`}
    aria-hidden="true"
  >
    <span
      className={`absolute -top-1 left-1 h-2.5 w-5 rounded-t-[0.35rem] border border-b-0 ${
        active
          ? 'border-[#5D7052] bg-[#DDE7D6]'
          : muted
            ? 'border-[#DED8CF] bg-[#EEE7DB]'
            : 'border-[#CDBF9C] bg-[#D9CAA7]'
      }`}
    />
  </span>
);

const DatasetOverview = ({ parts, totalRows }) => {
  const populatedParts = parts.filter((part) => part.total > 0).slice(0, 6);

  if (!totalRows) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-[1rem] border border-dashed border-[#DED8CF] bg-[#FDFCF8] p-6 text-center">
        <div>
          <h4 className="m-0 font-[Fraunces] text-xl font-bold text-[#2C2C24]">Dataset folders are ready</h4>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#78786C]">
            Reviewed expert submissions will appear here as labels. Empty folders stay visible so the future dataset structure is clear.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[1rem] border border-[#DED8CF]/60 bg-[#FDFCF8] p-4">
      <div className="mb-4">
        <h4 className="m-0 font-[Fraunces] text-xl font-bold text-[#2C2C24]">Reviewed dataset summary</h4>
        <p className="m-0 mt-1 text-sm text-[#78786C]">Open a folder on the left to inspect images or create a training set.</p>
      </div>
      <div className="grid gap-3">
        {populatedParts.map((part) => (
          <ProgressRow
            key={part.part}
            label={part.partLabel}
            meta={`${part.uniqueImages} images`}
            total={totalRows}
            value={part.total}
          />
        ))}
      </div>
    </div>
  );
};

const PartOverview = ({ bucket, topProblems, onOpenProblem }) => {
  if (!bucket) return <EmptyText text="Select a plant-part folder." />;

  return (
    <div className="rounded-[1rem] border border-[#DED8CF]/60 bg-[#FDFCF8] p-4">
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <FolderStat label="Reviewed labels" value={bucket.total} />
        <FolderStat label="Reviewed images" value={bucket.uniqueImages} />
        <FolderStat label="Ready labels" value={bucket.trainableCount} />
      </div>
      <h4 className="m-0 text-sm font-bold text-[#2C2C24]">Populated folders</h4>
      <p className="m-0 mt-1 text-xs text-[#78786C]">Choose one from the left, or use these shortcuts.</p>
      {!topProblems.length ? <EmptyText text="No reviewed labels in this plant-part folder yet." /> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {topProblems.map((problem) => (
          <button
            key={problem.problemType}
            className="rounded-full border border-[#DED8CF] bg-white px-3 py-2 text-xs font-bold text-[#2C2C24] transition hover:border-[#5D7052]/60 hover:bg-[#EEF2EA]"
            type="button"
            onClick={() => onOpenProblem(problem)}
          >
            {problem.problemLabel} · {problem.total}
          </button>
        ))}
      </div>
    </div>
  );
};

const FolderStat = ({ label, value }) => (
  <div className="rounded-[0.85rem] border border-[#DED8CF]/60 bg-white px-3 py-2">
    <span className="block text-[11px] font-bold uppercase tracking-[0.06em] text-[#8A7E6D]">{label}</span>
    <strong className="mt-1 block font-[Fraunces] text-xl text-[#2C2C24]">{value}</strong>
  </div>
);

const ProgressRow = ({ label, meta, total, value }) => {
  const width = total > 0 ? Math.max(2, Math.round((value / total) * 100)) : 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="font-bold text-[#2C2C24]">{label}</span>
        <span className="text-xs font-bold text-[#78786C]">{value} labels - {meta}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#E7E0D6]">
        <div className="h-full rounded-full bg-[#5D7052]" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};

const TrainingSection = ({ trainingJobs, modelCandidates, actionKey, onPublishCandidate }) => {
  const publishedModel = modelCandidates.find((candidate) => candidate.status === 'published');

  return (
    <div className="grid gap-4">
      <section className="rounded-[1.5rem] border border-[#DED8CF]/60 bg-[#FEFEFA] p-5 shadow-[0_8px_24px_-22px_rgba(44,44,36,0.45)]">
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr] xl:items-start">
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-[0.08em] text-[#5D7052]">Training</p>
            <h2 className="m-0 mt-1 font-[Fraunces] text-2xl font-bold text-[#2C2C24]">Current mode: manual training</h2>
            <p className="m-0 mt-2 text-sm leading-relaxed text-[#78786C]">
              Training does not run in the browser. Admins prepare reviewed data here, train the model manually, then review and publish the approved model.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <WorkflowStep number="1" title="Create training set" body="Choose reviewed labels from the Dataset tab." />
            <WorkflowStep number="2" title="Run training manually" body="Use the prepared set outside the browser." />
            <WorkflowStep number="3" title="Upload/review model" body="Check the trained model record and metrics." />
            <WorkflowStep number="4" title="Publish model" body="Make the approved model active for testing." />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
        <div className="grid gap-4">
          <ActiveModelPanel publishedModel={publishedModel} />
          <ModelTester />
        </div>
        <div className="grid gap-4">
          <TrainingJobsPanel trainingJobs={trainingJobs} />
          <ModelCandidatesPanel
            actionKey={actionKey}
            modelCandidates={modelCandidates}
            onPublishCandidate={onPublishCandidate}
          />
          <AdvancedTrainingDetails trainingJobs={trainingJobs} modelCandidates={modelCandidates} />
        </div>
      </div>
    </div>
  );
};

const ActiveModelPanel = ({ publishedModel }) => (
  <section className="rounded-[1.25rem] border border-[#DED8CF]/50 bg-[#FDFCF8] p-4">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h3 className="m-0 text-base font-bold text-[#2C2C24]">Current model</h3>
        <p className="m-0 mt-1 text-xs text-[#78786C]">The model used by the test tool.</p>
      </div>
      <Badge text={publishedModel ? 'Published registry record' : 'Bundled classifier'} tone={publishedModel ? 'green' : 'amber'} />
    </div>
    <div className="rounded-[1rem] border border-[#DED8CF]/60 bg-white p-3">
      <strong className="block font-[Fraunces] text-xl text-[#2C2C24]">
        {publishedModel?.modelVersion || CURRENT_MODEL_VERSION}
      </strong>
      <p className="m-0 mt-1 text-xs text-[#78786C]">
        {publishedModel
          ? `${partDisplayName(publishedModel.targetPart)} registry record - ${formatTimestamp(publishedModel.publishedAt || publishedModel.createdAt)}. This does not change the bundled tester artifact.`
          : 'The tester runs the classifier included in the deployed application.'}
      </p>
    </div>
  </section>
);

const AdvancedTrainingDetails = ({
  trainingJobs,
  modelCandidates,
  actionKey,
  onPublishCandidate,
}) => (
  <details className="rounded-[1.25rem] border border-[#DED8CF]/50 bg-[#FDFCF8] p-4">
    <summary className="cursor-pointer text-sm font-bold text-[#5D7052]">Advanced details</summary>
    <div className="mt-3 grid gap-4">
      <p className="m-0 rounded-[1rem] border border-[#DED8CF]/50 bg-white p-3 text-sm leading-relaxed text-[#78786C]">
        A training set is just a saved list of images and labels for manual training. It does not train the model by itself.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        <TrainingJobsPanel trainingJobs={trainingJobs} />
        <ModelCandidatesPanel
          actionKey={actionKey}
          modelCandidates={modelCandidates}
          onPublishCandidate={onPublishCandidate}
        />
      </div>
    </div>
  </details>
);

const TechnicalList = ({ title, items, emptyText }) => (
  <div className="rounded-[1rem] border border-[#DED8CF]/50 bg-white p-3">
    <h4 className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-[#8A7E6D]">{title}</h4>
    {!items.length ? <p className="m-0 mt-2 text-xs text-[#78786C]">{emptyText}</p> : null}
    <div className="mt-2 grid gap-1">
      {items.slice(0, 6).map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#F7F4EC] px-2 py-1.5">
          <span className="min-w-0 truncate font-mono text-[10px] text-[#2C2C24]">{item.id}</span>
          <span className="shrink-0 text-[10px] font-bold text-[#5D7052]">{item.status || 'draft'}</span>
        </div>
      ))}
    </div>
  </div>
);

const TrainingJobsPanel = ({ trainingJobs }) => (
  <section className="rounded-[1.25rem] border border-[#DED8CF]/50 bg-[#FDFCF8] p-4">
    <div className="mb-3">
      <h3 className="m-0 text-base font-bold text-[#2C2C24]">Prepared training sets</h3>
      <p className="m-0 mt-1 text-xs text-[#78786C]">Saved image-and-label lists for manual training.</p>
    </div>
    {!trainingJobs.length ? <EmptyText text="No training sets yet." /> : null}
    <div className="grid gap-2">
      {trainingJobs.slice(0, 8).map((job) => (
        <article key={job.id} className="rounded-[1rem] border border-[#DED8CF]/50 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="m-0 truncate text-sm font-bold text-[#2C2C24]">
                {optionLabel(BODY_PART_OPTIONS, job.targetPart, job.targetPart)} model
              </h4>
              <p className="m-0 mt-1 text-xs text-[#78786C]">
                {job.manifestItemCount ?? 0} reviewed labels - {formatTimestamp(job.createdAt)}
              </p>
            </div>
            <Badge text={job.status || 'draft'} tone={job.status === 'failed' ? 'red' : 'green'} />
          </div>
          {job.sourceCounts ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(job.sourceCounts).map(([source, count]) => (
                <Badge key={source} text={`${sourceLabel(source)}: ${count}`} tone="green" />
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(job.selectedLabels ?? []).map((label) => (
              <Badge key={label} text={optionLabel(PROBLEM_OPTIONS, label, label)} tone="blue" />
            ))}
          </div>
        </article>
      ))}
    </div>
  </section>
);

const ModelCandidatesPanel = ({ modelCandidates, actionKey, onPublishCandidate }) => (
  <section className="rounded-[1.25rem] border border-[#DED8CF]/50 bg-[#FDFCF8] p-4">
    <div className="mb-3">
      <h3 className="m-0 text-base font-bold text-[#2C2C24]">New model versions</h3>
      <p className="m-0 mt-1 text-xs text-[#78786C]">Review a trained model before making it active.</p>
    </div>
    {!modelCandidates.length ? <EmptyText text="No trained models yet." /> : null}
    <div className="grid gap-2">
      {modelCandidates.slice(0, 6).map((candidate) => {
        const canPublish =
          candidate.status !== 'published' &&
          candidate.artifactPaths?.modelJson &&
          candidate.artifactPaths?.labelsJson;
        return (
          <article key={candidate.id} className="rounded-[1rem] border border-[#DED8CF]/50 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="m-0 truncate text-sm font-bold text-[#2C2C24]">
                  {candidate.modelVersion || candidate.id}
                </h4>
                <p className="m-0 mt-1 text-xs text-[#78786C]">
                  {optionLabel(BODY_PART_OPTIONS, candidate.targetPart, candidate.targetPart)} - {formatTimestamp(candidate.createdAt)}
                </p>
              </div>
              <Badge
                text={candidate.status === 'candidate' ? 'trained' : candidate.status || 'trained'}
                tone={candidate.status === 'published' ? 'green' : 'amber'}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {candidate.metrics?.accuracy != null ? (
                <Badge text={`accuracy ${Math.round(Number(candidate.metrics.accuracy) * 100)}%`} tone="green" />
              ) : null}
              {Object.entries(candidate.labelCounts ?? {}).slice(0, 5).map(([label, count]) => (
                <Badge key={label} text={`${optionLabel(PROBLEM_OPTIONS, label, label)}: ${count}`} tone="blue" />
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <ActionButton
                label={candidate.status === 'published' ? 'Registered' : 'Publish record'}
                disabled={!canPublish || !!actionKey}
                loading={actionKey === `candidate:${candidate.id}`}
                onClick={() => onPublishCandidate(candidate.id)}
              />
            </div>
          </article>
        );
      })}
    </div>
  </section>
);

const MiniMetric = ({ label, value }) => (
  <div className="rounded-[1rem] border border-[#DED8CF]/50 bg-[#FDFCF8] px-3 py-2">
    <strong className="block font-[Fraunces] text-xl text-[#2C2C24]">{value}</strong>
    <span className="text-[11px] font-bold text-[#78786C]">{label}</span>
  </div>
);

const Badge = ({ text, tone = 'amber' }) => (
  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${badgeClass(tone)}`}>
    {text}
  </span>
);

const partDisplayName = (part) =>
  PART_DISPLAY_LABELS[part] ?? optionLabel(BODY_PART_OPTIONS, part, part || 'Unknown');

const problemDisplayName = (problem) =>
  PROBLEM_DISPLAY_LABELS[problem] ?? optionLabel(PROBLEM_OPTIONS, problem, problem || 'Unknown');

const sourceLabel = (source) => {
  if (source === 'legacy_dataset') return 'Uploaded dataset';
  if (source === 'expert_review') return 'Expert reviews';
  return source || 'Dataset';
};

// ─────────────────────────────────────────────────────────────────────────────
// Forecast Upload Section
// ─────────────────────────────────────────────────────────────────────────────

const GRADE_LABELS = { A: 'درجة A', AA: 'درجة AA', AAA: 'درجة AAA' };

const ForecastUploadSection = ({ adminUid }) => {
  const fileRef = useRef(null);
  const [meta, setMeta] = useState(null);
  const [uploadStatus, setUploadStatus] = useState({});
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetchForecastMeta()
      .then(setMeta)
      .catch(() => {});
  }, []);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setErrorMsg('يرجى اختيار ملف Excel بصيغة .xlsx أو .xls');
      return;
    }
    setErrorMsg('');
    setUploading(true);
    setUploadStatus({});

    try {
      const results = await uploadForecastExcel(file, adminUid, (grade, status) => {
        setUploadStatus((prev) => ({ ...prev, [grade]: status }));
      });

      const errors = Object.entries(results)
        .filter(([, v]) => v?.error)
        .map(([g, v]) => `${g}: ${v.error}`);

      if (errors.length) {
        setErrorMsg(errors.join(' | '));
      }

      const newMeta = await fetchForecastMeta();
      setMeta(newMeta);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="rounded-[1.5rem] border border-[#DED8CF]/50 bg-[#FEFEFA] p-4 shadow-[0_8px_24px_-22px_rgba(44,44,36,0.45)]">
      <div className="mb-3 flex flex-col gap-1">
        <h2 className="m-0 font-[Fraunces] text-lg font-bold text-[#2C2C24]">رفع بيانات التوقعات</h2>
        <p className="m-0 text-sm leading-relaxed text-[#78786C]">
          ارفع ملف Excel يحتوي على أوراق A وAA وAAA بالأعمدة المطلوبة للتوقعات.
        </p>
      </div>

      {meta ? (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {GRADES.map((g) => (
            <div key={g} className="rounded-[1rem] border border-[#DED8CF]/40 bg-[#FDFCF8] p-2.5 text-center">
              <div className="font-[Fraunces] text-base font-bold text-[#2C2C24]">{GRADE_LABELS[g]}</div>
              {meta[g] ? (
                <>
                  <div className="mt-0.5 text-sm font-bold text-[#5D7052]">{meta[g].count} صف</div>
                  <div className="mt-0.5 text-[10px] text-[#78786C]">{formatTimestampShort(meta[g].updatedAt)}</div>
                </>
              ) : (
                <div className="mt-0.5 text-xs text-[#78786C]">لا بيانات</div>
              )}
              {uploadStatus[g] ? (
                <div className="mt-1 text-xs font-bold text-[#C18C5D]">
                  {STATUS_LABELS[uploadStatus[g]] ?? uploadStatus[g]}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {errorMsg ? (
        <p className="mb-2 rounded-xl bg-[#A85448]/5 p-2.5 text-sm text-[#A85448]">{errorMsg}</p>
      ) : null}

      <label className="block">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleFileChange}
          disabled={uploading}
        />
        <button
          className={`w-full rounded-full border-none py-3.5 text-base font-bold transition ${
            uploading
              ? 'cursor-not-allowed bg-[#DED8CF] text-[#78786C]'
              : 'cursor-pointer bg-[#5D7052] text-white shadow-[0_4px_16px_-2px_rgba(93,112,82,0.2)] hover:scale-[1.01] active:scale-[0.99]'
          }`}
          type="button"
          onClick={() => !uploading && fileRef.current?.click()}
          aria-label="رفع ملف Excel للتوقعات"
        >
          {uploading ? 'جاري المعالجة...' : 'اختيار ملف Excel ورفعه'}
        </button>
      </label>
    </section>
  );
};

const getRecordMeta = (sectionKey, item) => {
  if (sectionKey === 'diagnoses') return diagnosisMeta(item);
  if (sectionKey === 'farmerMessages') return farmerMessageMeta(item);
  if (sectionKey === 'farmerChat') return farmerChatMeta(item);
  if (sectionKey === 'expertNotes') return expertNoteMeta(item);
  if (sectionKey === 'pricePosts') return pricePostMeta(item);
  if (sectionKey === 'hydroAlerts') return hydroAlertMeta(item);
  return genericMeta(item);
};

const diagnosisMeta = (item) => {
  const statusMeta = DIAGNOSIS_STATUS_META[item.status] ?? {
    label: item.status || 'غير محدد',
    tone: 'amber',
  };
  const observations = Array.isArray(item.observations) && item.observations.length
    ? item.observations
    : Array.isArray(item.problems)
      ? item.problems
      : [];
  const summary = observations.length
    ? observations.map(formatObservation).join('، ')
    : item.expertNote || 'لا توجد مراجعة مفصلة بعد.';
  return {
    title: item.farmerName || 'تشخيص بدون اسم مزارع',
    subtitle: `${item.farmerRegion || 'منطقة غير محددة'} • ${formatTimestamp(item.createdAt)}`,
    badge: statusMeta.label,
    badgeClass: badgeClass(statusMeta.tone),
    body: summary,
    details: [
      item.reviewedByName ? `الخبير: ${item.reviewedByName}` : null,
      item.overallSeverity ? `الشدة: ${optionLabel(SEVERITY_OPTIONS, item.overallSeverity)}` : null,
      item.imageQuality ? `جودة الصورة: ${item.imageQuality}` : null,
    ].filter(Boolean),
    preview: item.imageUrl ? imagePreview(item.imageUrl, 'صورة التشخيص') : null,
    showWeatherContext: true,
  };
};

const farmerMessageMeta = (item) => ({
  title: item.farmerName || 'رسالة مزارع',
  subtitle: `${item.farmerPhone || 'لا هاتف'} • ${formatTimestamp(item.createdAt)}`,
  badge: item.type === 'audio' ? 'صوت' : 'صورة',
  badgeClass: badgeClass('blue'),
  body: 'رسالة مباشرة إلى الخبراء.',
  details: [item.farmerId ? `المزارع: ${item.farmerId}` : null].filter(Boolean),
  preview: mediaPreview(item.fileUrl, item.type, 'وسيط مرسل للخبير'),
});

const farmerChatMeta = (item) => ({
  title: item.senderName || 'رسالة مجتمع',
  subtitle: formatTimestamp(item.createdAt),
  badge: item.type === 'text' ? 'نص' : item.type === 'audio' ? 'صوت' : 'صورة',
  badgeClass: badgeClass('amber'),
  body: item.type === 'text' ? truncate(item.content, 220) : 'وسيط منشور في غرفة المزارعين.',
  details: [item.senderId ? `المرسل: ${item.senderId}` : null].filter(Boolean),
  preview: item.type === 'text' ? null : mediaPreview(item.content, item.type, 'وسيط من غرفة المزارعين'),
});

const expertNoteMeta = (item) => ({
  title: item.subject || 'توجيه خبير',
  subtitle: `${item.region || 'كل المناطق'} • ${formatTimestamp(item.createdAt)}`,
  badge: 'توجيه',
  badgeClass: badgeClass('green'),
  body: truncate(item.body, 260),
  details: [item.expertName ? `الخبير: ${item.expertName}` : null].filter(Boolean),
  preview: null,
});

const pricePostMeta = (item) => ({
  title: item.farmerName || 'منشور سعر',
  subtitle: `${item.region || 'منطقة غير محددة'} • ${formatTimestamp(item.createdAt)}`,
  badge: `${item.quality || 'A'} • ${item.price ?? '--'} درهم`,
  badgeClass: badgeClass('green'),
  body: 'منشور سعر من السوق.',
  details: [item.farmerId ? `المزارع: ${item.farmerId}` : null].filter(Boolean),
  preview: item.imageUrl ? imagePreview(item.imageUrl, 'صورة منشور السعر') : null,
});

const hydroAlertMeta = (item) => ({
  title: item.type || 'تنبيه نبات',
  subtitle: `${item.deviceId || 'جهاز غير محدد'} • ${formatTimestamp(item.createdAt)}`,
  badge: item.status || 'open',
  badgeClass: badgeClass(item.status === 'resolved' ? 'green' : 'red'),
  body: item.message || 'لا توجد رسالة.',
  details: [
    item.confidence != null ? `الثقة: ${Math.round(Number(item.confidence) * 100)}%` : null,
    item.ownerId ? `المالك: ${item.ownerId}` : null,
  ].filter(Boolean),
  preview: item.imageUrl ? imagePreview(item.imageUrl, 'صورة تنبيه هيدروبونيك') : null,
});

const genericMeta = (item) => ({
  title: item.name || item.id,
  subtitle: formatTimestamp(item.createdAt),
  badge: 'عنصر',
  badgeClass: badgeClass('amber'),
  body: '',
  details: [],
  preview: null,
});

const imagePreview = (src, alt) => (
  <img src={src} alt={alt} className="h-48 w-full bg-[#DED8CF] object-cover" loading="lazy" />
);

const mediaPreview = (src, type, alt) => {
  if (!src) return null;
  if (type === 'audio') {
    return (
      <div className="bg-[#EEF2EA] p-4">
        <audio controls className="w-full">
          <source src={src} />
        </audio>
      </div>
    );
  }
  return imagePreview(src, alt);
};

const formatObservation = (observation = {}) => {
  const part = optionLabel(BODY_PART_OPTIONS, observation.bodyPart, 'جزء غير محدد');
  const problem =
    observation.problemType === 'other' && observation.manualLabel
      ? observation.manualLabel
      : optionLabel(PROBLEM_OPTIONS, observation.problemType, 'مشكلة غير محددة');
  const severity = optionLabel(SEVERITY_OPTIONS, observation.severity, '');
  return `${part}: ${problem}${severity ? ` (${severity})` : ''}`;
};

const getRecordTitle = (sectionKey, item) => getRecordMeta(sectionKey, item).title;

const badgeClass = (tone = 'amber') => {
  const classes = {
    amber: 'bg-[#FFF6D8] text-[#8A5A00]',
    blue: 'bg-[#EAF2FF] text-[#315D8F]',
    green: 'bg-[#EEF2EA] text-[#5D7052]',
    red: 'bg-[#FDECEC] text-[#A85448]',
  };
  return classes[tone] ?? classes.amber;
};

const folderReadiness = (folder = {}, minReviewedCount = DEFAULT_MIN_REVIEWED_COUNT) => {
  if (!folder.total) return { label: 'empty', tone: 'amber' };
  const hasReadyProblem = Array.isArray(folder.problems)
    ? folder.problems.some(
      (problem) => problem.isTrainable && problem.trainableCount >= minReviewedCount,
    )
    : false;
  if (hasReadyProblem || folder.trainableCount >= minReviewedCount) {
    return { label: 'ready', tone: 'green' };
  }
  return { label: 'needs more data', tone: 'amber' };
};

const roleLabel = (role) => {
  if (role === 'admin') return 'مسؤول';
  if (role === 'expert') return 'خبير';
  return 'مزارع';
};

const truncate = (value = '', max = 180) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const timestampToDate = (ts) => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts === 'number') return new Date(ts);
  if (typeof ts === 'string') return new Date(ts);
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
};

const formatTimestamp = (ts) => {
  const date = timestampToDate(ts);
  if (!date || Number.isNaN(date.getTime())) return 'تاريخ غير محدد';
  return date.toLocaleString('ar-MA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const STATUS_LABELS = {
  parsing: 'جاري التحليل...',
  uploading: 'جاري الرفع...',
  done: 'تم',
  missing: 'ورقة مفقودة',
  empty: 'لا صفوف',
};

const formatTimestampShort = (ts) => {
  const date = timestampToDate(ts);
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ar-MA', { day: 'numeric', month: 'short' });
};

const NON_TRAINING_PROBLEMS = new Set(['unknown_needs_more_info', 'other']);

const buildDatasetRows = (diagnoses = [], legacyImages = []) => [
  ...diagnoses.flatMap((diagnosis) => {
    if (diagnosis.status !== 'reviewed' || diagnosis.imageQuality === 'unusable') return [];
    const observations = Array.isArray(diagnosis.observations) && diagnosis.observations.length
      ? diagnosis.observations
      : Array.isArray(diagnosis.problems)
        ? diagnosis.problems
        : [];

    return observations
      .map((observation, index) => {
        const bodyPart = observation.bodyPart || diagnosis.primaryBodyPart || diagnosis.bodyPart;
        const problemType = observation.problemType || 'other';
        if (!bodyPart || !problemType) return null;
        const problemLabel =
          problemType === 'other' && observation.manualLabel
            ? observation.manualLabel
            : optionLabel(PROBLEM_OPTIONS, problemType, problemType);
        return {
          rowId: `${diagnosis.id}:${index}`,
          sourceType: 'expert_review',
          sourceCollection: 'visionDiagnoses',
          diagnosisId: diagnosis.id,
          datasetImageId: null,
          imagePath: diagnosis.imagePath ?? null,
          imageUrl: diagnosis.imageUrl ?? null,
          bodyPart,
          bodyPartLabel: optionLabel(BODY_PART_OPTIONS, bodyPart, bodyPart),
          problemType,
          problemLabel,
          manualLabel: observation.manualLabel ?? '',
          severity: observation.severity ?? null,
          confidence: observation.confidence ?? null,
          spread: observation.spread ?? null,
          imageQuality: diagnosis.imageQuality ?? null,
          farmerId: diagnosis.farmerId ?? null,
          farmerName: diagnosis.farmerName || 'Unknown farmer',
          farmerRegion: diagnosis.farmerRegion ?? null,
          createdAt: diagnosis.createdAt ?? null,
          reviewedAt: diagnosis.reviewedAt ?? null,
          reviewedBy: diagnosis.reviewedBy ?? null,
          reviewedByName: diagnosis.reviewedByName ?? null,
          trainable: Boolean(diagnosis.imagePath) && !NON_TRAINING_PROBLEMS.has(problemType),
        };
      })
      .filter(Boolean);
  }),
  ...legacyImages
    .map((image) => {
      if (image.status && image.status !== 'active') return null;
      const bodyPart = image.bodyPart || 'leaf';
      const problemType = image.problemType || image.labels?.[0];
      if (!bodyPart || !problemType) return null;
      return {
        rowId: `dataset:${image.id}`,
        sourceType: 'legacy_dataset',
        sourceCollection: 'datasetImages',
        diagnosisId: null,
        datasetImageId: image.id,
        imagePath: image.imagePath ?? null,
        imageUrl: image.imageUrl ?? null,
        bodyPart,
        bodyPartLabel: optionLabel(BODY_PART_OPTIONS, bodyPart, bodyPart),
        problemType,
        problemLabel: problemDisplayName(problemType),
        manualLabel: '',
        severity: image.severity ?? null,
        confidence: image.confidence ?? null,
        spread: image.spread ?? null,
        imageQuality: image.imageQuality ?? null,
        farmerId: null,
        farmerName: image.sourceName || image.sourceDataset || 'Uploaded dataset',
        farmerRegion: null,
        sourceDataset: image.sourceDataset ?? null,
        originalSplit: image.originalSplit ?? null,
        effectiveSplit: image.effectiveSplit ?? null,
        createdAt: image.createdAt ?? null,
        reviewedAt: image.updatedAt ?? image.createdAt ?? null,
        reviewedBy: null,
        reviewedByName: 'Imported dataset',
        trainable: Boolean(image.imagePath) && !NON_TRAINING_PROBLEMS.has(problemType),
      };
    })
    .filter(Boolean),
];

const buildDatasetSummary = (rows = []) => {
  const partMap = new Map(
    BODY_PART_OPTIONS.map((part) => [
      part.value,
      {
        part: part.value,
        partLabel: part.label,
        total: 0,
        trainableCount: 0,
        uniqueImages: new Set(),
        problems: new Map(
          PROBLEM_OPTIONS.map((problem) => [
            problem.value,
            {
              problemType: problem.value,
              problemLabel: problem.label,
              total: 0,
              trainableCount: 0,
              uniqueImages: new Set(),
              isTrainable: !NON_TRAINING_PROBLEMS.has(problem.value),
            },
          ]),
        ),
      },
    ]),
  );
  const uniqueImages = new Set();

  rows.forEach((row) => {
    if (row.imagePath) uniqueImages.add(row.imagePath);
    if (!partMap.has(row.bodyPart)) {
      partMap.set(row.bodyPart, {
        part: row.bodyPart,
        partLabel: row.bodyPartLabel,
        total: 0,
        trainableCount: 0,
        uniqueImages: new Set(),
        problems: new Map(
          PROBLEM_OPTIONS.map((problem) => [
            problem.value,
            {
              problemType: problem.value,
              problemLabel: problem.label,
              total: 0,
              trainableCount: 0,
              uniqueImages: new Set(),
              isTrainable: !NON_TRAINING_PROBLEMS.has(problem.value),
            },
          ]),
        ),
      });
    }
    const part = partMap.get(row.bodyPart);
    part.total += 1;
    if (row.trainable) part.trainableCount += 1;
    if (row.imagePath) part.uniqueImages.add(row.imagePath);

    if (!part.problems.has(row.problemType)) {
      part.problems.set(row.problemType, {
        problemType: row.problemType,
        problemLabel: row.problemLabel,
        total: 0,
        trainableCount: 0,
        uniqueImages: new Set(),
        isTrainable: !NON_TRAINING_PROBLEMS.has(row.problemType),
      });
    }
    const problem = part.problems.get(row.problemType);
    problem.total += 1;
    if (row.trainable) problem.trainableCount += 1;
    if (row.imagePath) problem.uniqueImages.add(row.imagePath);
  });

  const parts = Array.from(partMap.values())
    .map((part) => ({
      ...part,
      uniqueImages: part.uniqueImages.size,
      problems: Array.from(part.problems.values())
        .map((problem) => ({
          ...problem,
          uniqueImages: problem.uniqueImages.size,
        }))
        .sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total;
          const ai = PROBLEM_OPTIONS.findIndex((option) => option.value === a.problemType);
          const bi = PROBLEM_OPTIONS.findIndex((option) => option.value === b.problemType);
          return ai - bi;
        }),
    }))
    .sort((a, b) => {
      const ai = BODY_PART_OPTIONS.findIndex((option) => option.value === a.part);
      const bi = BODY_PART_OPTIONS.findIndex((option) => option.value === b.part);
      return ai - bi;
    });

  return {
    totalRows: rows.length,
    uniqueImages: uniqueImages.size,
    parts,
    partsByKey: new Map(parts.map((part) => [part.part, part])),
  };
};

const buildTrainingManifest = ({ rows, targetPart, selectedLabels, minReviewedCount }) => {
  const selectedSet = new Set((selectedLabels ?? []).filter(Boolean));
  const scopedRows = rows.filter(
    (row) =>
      row.bodyPart === targetPart &&
      row.trainable &&
      (!selectedSet.size || selectedSet.has(row.problemType)),
  );
  const rawCounts = scopedRows.reduce((acc, row) => {
    acc[row.problemType] = (acc[row.problemType] ?? 0) + 1;
    return acc;
  }, {});
  const eligibleLabels = Object.entries(rawCounts)
    .filter(([, count]) => count >= minReviewedCount)
    .map(([label]) => label);
  const eligibleSet = new Set(eligibleLabels);
  const items = scopedRows
    .filter((row) => eligibleSet.has(row.problemType))
    .map((row) => ({
      diagnosisId: row.diagnosisId,
      datasetImageId: row.datasetImageId,
      sourceType: row.sourceType,
      sourceCollection: row.sourceCollection,
      rowId: row.rowId,
      imagePath: row.imagePath,
      imageUrl: row.imageUrl,
      bodyPart: row.bodyPart,
      problemType: row.problemType,
      manualLabel: row.manualLabel,
      sourceDataset: row.sourceDataset,
      originalSplit: row.originalSplit,
      effectiveSplit: row.effectiveSplit,
      expertConfidence: row.confidence,
      severity: row.severity,
      spread: row.spread,
      imageQuality: row.imageQuality,
      reviewedBy: row.reviewedBy,
      reviewedByName: row.reviewedByName,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
    }));
  const labelCounts = items.reduce((acc, item) => {
    acc[item.problemType] = (acc[item.problemType] ?? 0) + 1;
    return acc;
  }, {});

  return {
    selectedLabels: eligibleLabels,
    labelCounts,
    items,
  };
};

export default AdminDashboard;
