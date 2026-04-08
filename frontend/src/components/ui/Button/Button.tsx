import styles from './Button.module.css';
import { Link } from 'react-router-dom';

interface ButtonProps {
    color: 'primary' | 'secondary' | 'muted';
    variant?: 'filled' | 'outline' | 'ghost';
    size?: 'sm' | 'm' | 'l' | 'xl';
    disabled?: boolean;
    to?: string;
    icon?: React.ReactNode;
    onClick?: () => void;
    children?: React.ReactNode;
}

export default function Button({ to, color = 'primary', size = 'm', variant = 'filled', icon, onClick, children, disabled }: ButtonProps) {
        const className = `${styles.button} ${styles[color]} ${styles[size]} ${styles[variant]} ${disabled ? styles.disabled : ''} ${icon && !children ? styles.onlyIcon : ''}`;
    return (
        to ? (
            <Link to={to} className={className} onClick={onClick}>
                {children}
                {icon && <span className={styles.icon}>{icon}</span>}
            </Link>
        ) : (
            <button className={className} onClick={onClick} disabled={disabled}>
                {children}
                {icon && <span className={styles.icon}>{icon}</span>}
            </button>
        )
    )
}