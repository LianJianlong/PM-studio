import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, } from "react";
// Rendered through the catalog's portal so sidebar clipping cannot hide actions.
export default function CatalogMenu({ anchor, name, onClose, children, }: {
    anchor: HTMLElement;
    name: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const panel = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    useLayoutEffect(() => {
        const rect = anchor.getBoundingClientRect();
        const box = panel.current!.getBoundingClientRect();
        setPosition({
            left: Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8)),
            top: rect.bottom + box.height + 8 <= window.innerHeight
                ? rect.bottom + 4
                : Math.max(8, rect.top - box.height - 4),
        });
        panel.current
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus({ preventScroll: true });
    }, [anchor]);
    useEffect(() => {
        function dismiss(e: Event) {
            if (e.type === "scroll" && panel.current?.contains(e.target as Node))
                return;
            onClose();
        }
        window.addEventListener("resize", dismiss);
        window.addEventListener("scroll", dismiss, true);
        return () => {
            window.removeEventListener("resize", dismiss);
            window.removeEventListener("scroll", dismiss, true);
            if (anchor.isConnected)
                anchor.focus({ preventScroll: true });
        };
    }, [anchor, onClose]);
    return (<div className="catalog-menu-backdrop" onPointerDown={(e) => {
            if (e.target === e.currentTarget)
                onClose();
        }}>
      <div ref={panel} className="catalog-popup" style={position} role="menu" aria-label={__uiFormat("{0} 目录操作", [name])} onKeyDown={(e) => {
            const buttons = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "Escape" || e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
            else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next = e.key === "Home"
                    ? 0
                    : e.key === "End"
                        ? buttons.length - 1
                        : (index +
                            (e.key === "ArrowDown" ? 1 : -1) +
                            buttons.length) %
                            buttons.length;
                buttons[next]?.focus();
            }
        }}>
        <strong className="catalog-popup-title">{__ui(name)}</strong>
        {__ui(children)}
      </div>
    </div>);
}
