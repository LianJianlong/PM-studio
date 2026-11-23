import { translateUiValue as __ui } from "./i18n";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, } from "lucide-react";
export function usePanelCollapsed(name: string, compactDefault = false, initiallyCollapsed = false) {
    const key = `project-studio:panels:v1:${name}`;
    const [collapsed, setCollapsed] = useState(() => {
        try {
            const value = localStorage.getItem(key);
            if (value !== null)
                return value === "collapsed";
        }
        catch {
            /* Layout remains usable when browser storage is unavailable. */
        }
        return initiallyCollapsed || (compactDefault && window.matchMedia("(max-width: 980px)").matches);
    });
    useEffect(() => {
        try {
            localStorage.setItem(key, collapsed ? "collapsed" : "expanded");
        }
        catch {
            /* Preferences are optional; toggling still works for this page. */
        }
    }, [key, collapsed]);
    return [collapsed, () => setCollapsed((value) => !value)] as const;
}
export default function PanelToggle({ name, controls, collapsed, onToggle, side = "left", }: {
    name: string;
    controls: string;
    collapsed: boolean;
    onToggle: () => void;
    side?: "left" | "right";
}) {
    const label = `${collapsed ? "展开" : "折叠"}${name}`;
    const Icon = side === "right"
        ? collapsed
            ? PanelRightOpen
            : PanelRightClose
        : collapsed
            ? PanelLeftOpen
            : PanelLeftClose;
    return (<button type="button" className="icon-button panel-toggle" title={__ui(label)} aria-label={__ui(label)} aria-expanded={!collapsed} aria-controls={controls} onClick={onToggle}>
      <Icon size={18}/>
    </button>);
}

/** Keep touch layout preference separate from the desktop catalog width/state. */
export function useResponsiveCatalog(){
 const [small,setSmall]=useState(()=>window.matchMedia('(max-width: 980px)').matches);
 const desktop=usePanelCollapsed('catalog'),touch=usePanelCollapsed('catalog-touch',true,true);
 useEffect(()=>{const media=window.matchMedia('(max-width: 980px)'),update=()=>setSmall(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
 return small?touch:desktop;
}
