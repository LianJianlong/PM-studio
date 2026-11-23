import { translateUiValue as __ui } from "./i18n";
import logo from "./assets/project-v.svg";
export default function ProjectLogo() {
    return (<img className="project-logo" src={logo} alt={__ui("项目标志：绿色圆角方块与彩色渐变 V")} width={40} height={40}/>);
}
