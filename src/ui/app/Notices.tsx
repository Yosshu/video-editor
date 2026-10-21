import { dismissNotice, useEditor } from '../../state/store';

export function Notices() {
  const notices = useEditor((s) => s.notices);
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice notice-${n.kind}`} onClick={() => dismissNotice(n.id)}>
          {n.message}
        </div>
      ))}
    </div>
  );
}
