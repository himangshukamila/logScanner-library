import styles from '../styles.css?inline';

const styleElementId = 'logscan-styles';

export function ensureStylesInjected(): void {
  // inject styles into the document head if not already present
  if (typeof document === 'undefined') return;
  if (document.getElementById(styleElementId)) return;

  const style = document.createElement('style');
  style.id = styleElementId;
  style.textContent = styles;
  document.head.appendChild(style);
}
