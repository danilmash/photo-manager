import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import styles from './ImportNavButton.module.css';

export default function ImportNavButton() {
  return (
    <Link to="/import" className={styles.btn}>
      <Upload size={18} strokeWidth={2} aria-hidden />
      <span>Импорт</span>
    </Link>
  );
}
