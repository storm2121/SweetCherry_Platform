import { useEffect, useRef, useState } from 'react';
import metadata from '../data/edgeModelFingerprint.json';
import { bundledModelVersion } from '../utils/edgeModelContract.js';

const MODEL_VERSION = bundledModelVersion(metadata.fingerprint);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const ModelTester = () => {
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const requestRef = useRef(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageReady, setImageReady] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  useEffect(() => () => { requestRef.current += 1; }, []);

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || testing) return;
    requestRef.current += 1;
    setResult(null);
    setError('');
    setImageReady(false);
    setPreviewUrl('');
    if (!file.type.startsWith('image/') || file.size > MAX_IMAGE_BYTES) {
      setError('Choose an image smaller than 20 MB.');
      return;
    }
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleRun = async () => {
    if (!imageRef.current || !imageReady || testing) return;
    const requestId = ++requestRef.current;
    setTesting(true);
    setError('');
    setResult(null);
    try {
      const { classifyImage } = await import('../services/edgeInferenceService.js');
      const prediction = await classifyImage(imageRef.current);
      if (requestId === requestRef.current) setResult(prediction);
    } catch {
      if (requestId === requestRef.current) setError('The bundled classifier could not run. Reload the page and try again; check that its model files are deployed.');
    } finally {
      if (requestId === requestRef.current) setTesting(false);
    }
  };

  return (
    <section className="rounded-[1.25rem] border border-[#DED8CF]/50 bg-[#FDFCF8] p-4" aria-busy={testing}>
      <div className="mb-3">
        <h3 className="m-0 text-base font-bold text-[#2C2C24]">Bundled leaf classifier</h3>
        <p className="m-0 mt-1 text-xs text-[#78786C]">Test the six-class model included in this application. Registry publication does not switch this tester to another artifact.</p>
        <p className="m-0 mt-1 text-xs text-[#78786C]">The test image stays in this browser. Farmer submissions continue through expert review.</p>
      </div>
      <input ref={fileRef} className="hidden" type="file" accept="image/*" disabled={testing} onChange={handleFile} />
      <button
        className="mb-3 w-full rounded-full border border-[#DED8CF] bg-white px-4 py-2.5 text-sm font-bold text-[#2C2C24] transition hover:border-[#5D7052]/50 disabled:opacity-50"
        type="button" disabled={testing} onClick={() => fileRef.current?.click()}
      >Choose test image</button>
      {previewUrl ? (
        <img ref={imageRef} src={previewUrl} alt="Selected image for local model test"
          className="mb-3 h-56 w-full rounded-[1rem] bg-[#DED8CF] object-contain"
          onLoad={() => setImageReady(true)}
          onError={() => { setImageReady(false); setError('This image could not be opened. Choose another image.'); }} />
      ) : (
        <div className="mb-3 grid h-56 place-items-center rounded-[1rem] border border-dashed border-[#DED8CF] bg-white text-sm text-[#78786C]">No test image selected</div>
      )}
      <button className="w-full rounded-full bg-[#5D7052] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        type="button" disabled={!imageReady || testing} onClick={handleRun}>
        {testing ? 'Running classifier…' : 'Run local test'}
      </button>
      <p className="mt-3 break-all text-xs text-[#78786C]">Bundled version: {MODEL_VERSION}</p>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-[#FDECEC] p-3 text-sm font-bold text-[#A85448]">{error}</p> : null}
      {result ? (
        <div className="mt-3 rounded-[1rem] border border-[#DED8CF]/50 bg-white p-3" role="status">
          <h4 className="m-0 text-sm font-bold text-[#2C2C24]">Highest class scores</h4>
          <p className="mt-1 text-xs text-[#78786C]">These are model scores for this image, not a measured accuracy rate or an expert verdict.</p>
          <div className="mt-2 grid gap-2">
            {result.top3.map((item) => (
              <div key={item.labelId} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                <span className="min-w-0 text-[#2C2C24]" lang="ar" dir="rtl">{item.label}</span>
                <strong className="text-[#5D7052]">{(item.confidence * 100).toFixed(1)}%</strong>
              </div>
            ))}
          </div>
          <p className="mb-0 mt-2 text-xs text-[#78786C]">Execution: {result.backend === 'webgl' ? 'WebGL' : 'CPU'} · {result.modelVersion}</p>
        </div>
      ) : null}
    </section>
  );
};

export default ModelTester;
