// Photo or voice note attached to a question or message. onLoad fires once
// the photo has its real size, so a thread can keep its newest message in view.
const MessageMedia = ({ type, fileUrl, description = '', onLoad }) => {
  if (!fileUrl) return null;
  if (type === 'audio') {
    return <audio controls preload="metadata" src={fileUrl} aria-label={description || 'تسجيل صوتي'} onLoadedMetadata={onLoad} />;
  }
  if (type === 'image') {
    return (
      <a href={fileUrl} target="_blank" rel="noreferrer" aria-label="فتح الصورة بالحجم الكامل">
        <img src={fileUrl} alt={description || 'صورة مرفقة'} onLoad={onLoad} />
      </a>
    );
  }
  return null;
};

export default MessageMedia;
