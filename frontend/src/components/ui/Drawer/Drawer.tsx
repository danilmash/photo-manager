import { useEffect } from "react";
import { createPortal } from "react-dom";
import styles from './Drawer.module.css'
import { X } from "lucide-react";
import Button from "../Button/Button";
import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';

const DRAWER_WIDTH = 360;

interface DrawerProps {
    title?: string;
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    side?: "right" | "left";
    behavior?: "overlap" | "move";
    // Если передан — дравер рендерится внутри этого элемента (для использования в модалках)
    portalTarget?: HTMLElement | null;
}

export default function Drawer({
    title = 'Drawer title',
    open,
    onClose,
    children,
    side = "right",
    behavior = "overlap",
    portalTarget,
}: DrawerProps) {
    const isContained = !!portalTarget; // режим внутри контейнера

    useBodyScrollLock(open && behavior === "overlap" && !isContained);

    // Закрытие по Escape
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    // Сдвиг контента в режиме move
    useEffect(() => {
        if (behavior !== "move") return;

        // Целевой элемент: контейнер (модалка) или body
        const target = portalTarget ?? document.body;
        const isMobile = !isContained && window.innerWidth < 600;
        if (isMobile) return;

        const prop = side === "right" ? "paddingRight" : "paddingLeft";
        target.style.transition = "padding 0.3s ease";
        target.style.boxSizing = "border-box";
        target.style[prop] = open ? `${DRAWER_WIDTH}px` : "0px";

        return () => {
        target.style[prop] = "0px";
        };
    }, [open, behavior, side, portalTarget, isContained]);

    const drawer = (
        <>
            {behavior === "overlap" && (
                <div
                className={`${styles['drawer-overlay']} ${isContained ? styles['drawer-overlay-contained'] : ""} ${open ? styles.open : ""}`}
                onClick={onClose}
                />
            )}

            <aside
                className={[
                styles.drawer,
                isContained ? styles['drawer-contained'] : "",
                styles[`drawer-${side}`],
                styles[`drawer-${behavior}`],
                open ? styles.open : "",
                ].join(" ")}
            >
                <div className={styles['drawer-header']}>
                <h3 className={styles['drawer-title']}>{title}</h3>
                <Button color="muted" variant="ghost" onClick={onClose} icon={<X />} size="l" />
                </div>
                <div className={styles['drawer-content']}>{children}</div>
            </aside>
        </>
    );

    // Если есть контейнер — портируем внутрь него, иначе в body
    return portalTarget
        ? createPortal(drawer, portalTarget)
        : createPortal(drawer, document.body);
}