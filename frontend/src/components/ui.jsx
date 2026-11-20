import { AlertCircle, LoaderCircle } from 'lucide-react';

export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && <div className="panel-heading">{title && <h2>{title}</h2>}{action}</div>}
      {children}
    </section>
  );
}

export function Notice({ children, tone = 'error' }) {
  if (!children) return null;
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    {tone === 'error' && <AlertCircle size={17} />}{children}
  </div>;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><LoaderCircle className="spin" size={20} />{label}</div>;
}

export function EmptyState({ title, message }) {
  return <div className="empty-state"><div className="empty-mark">AC</div><strong>{title}</strong><span>{message}</span></div>;
}

export function StatusBadge({ children, tone }) {
  const normalized = tone || String(children || '').toLowerCase().replaceAll(' ', '-');
  return <span className={`badge badge-${normalized}`}>{children}</span>;
}

export function Field({ label, className = '', ...props }) {
  return <label className={`field ${className}`}>
    <span>{label}</span>
    {props.as === 'textarea'
      ? <textarea {...props} as={undefined} />
      : props.as === 'select'
        ? <select {...props} as={undefined}>{props.children}</select>
        : <input {...props} as={undefined} />}
  </label>;
}

export function AsyncButton({ busy, children, ...props }) {
  return <button {...props} disabled={busy || props.disabled}>
    {busy && <LoaderCircle className="spin" size={16} />}{children}
  </button>;
}
