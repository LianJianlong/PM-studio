import {saveSyncedPreference} from './view-preference-sync';
import {setInterfaceLanguage, translateUiText} from "./i18n";
import { createContext, useContext, useEffect, useState } from "react";

export type Preferences = { language: "zh-CN" | "en"; theme: "light" | "dark" | "system"; accent: "green" | "blue"; density: "comfortable" | "compact"; textSize: "standard" | "large" };
export const defaultPreferences: Preferences = { language: "zh-CN", theme: "light", accent: "green", density: "comfortable", textSize: "standard" };
function readPreferences(key: string): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return { language: (value.language || localStorage.getItem("project-studio:language")) === "en" ? "en" : "zh-CN", theme: ["light", "dark", "system"].includes(value.theme) ? value.theme : "light", accent: value.accent === "blue" ? "blue" : "green", density: value.density === "compact" ? "compact" : "comfortable", textSize: value.textSize === "large" ? "large" : "standard" };
  } catch { return { ...defaultPreferences }; }
}
export function usePreferences(userId?: string) {
  const key = `project-studio:preferences:v1:${userId || "guest"}`;
  const [saved, setSaved] = useState(() => ({ key, value: readPreferences(key) }));
  const preferences = saved.key === key ? saved.value : readPreferences(key);
  setInterfaceLanguage(preferences.language);
  useEffect(()=>{const synced=()=>setSaved({key,value:readPreferences(key)});window.addEventListener('project-studio:preferences-synced',synced);return()=>window.removeEventListener('project-studio:preferences-synced',synced)},[key]);
  const [storageError, setStorageError] = useState(false);
  function updatePreferences(patch: Partial<Preferences>) {
    const next = { ...preferences, ...patch };
    try { saveSyncedPreference(key, next); localStorage.setItem("project-studio:language",next.language); setStorageError(false); } catch { setStorageError(true); }
    setSaved({ key, value: next });
  }
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme = preferences.theme === "system" ? media.matches ? "dark" : "light" : preferences.theme;
      root.dataset.accent = preferences.accent;
      root.dataset.density = preferences.density;
      root.dataset.textSize = preferences.textSize;
      root.lang = preferences.language;
      document.title = preferences.language === "en" ? "Project Studio · Project management" : "Project Studio · 项目管理平台";
    };
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.language, preferences.theme, preferences.accent, preferences.density, preferences.textSize]);
  return { preferences, updatePreferences, storageError };
}

const english: Record<string, string> = {
  "项目管理平台": "Project management", "工作空间": "Workspace", "项目": "Project", "功能导航": "Navigation",
  "事项与日历": "Tasks & calendar", "项目总览": "Overview", "部门工作台": "Departments", "数据录入": "Data entry", "数据中心": "Data entry", "项目文件": "Project files", "业主事项": "Owner items", "计划管理": "Planning", "统计分析": "Analytics", "报表中心": "Reports", "AI助手": "AI assistant", "AI 分析员": "AI assistant", "日历待办": "Calendar", "申请与审批": "Approvals", "用户与权限": "Users & permissions", "对象管理": "Object manager",
  "个人设置": "Personal settings", "修改密码": "Change password", "退出登录": "Sign out", "界面偏好": "Appearance & language", "界面语言": "Interface language", "界面风格": "Theme", "浅色": "Light", "深色": "Dark", "跟随系统": "System", "主题色": "Accent color", "翡翠绿": "Emerald", "湖泊蓝": "Ocean blue", "显示密度": "Display density", "舒适": "Comfortable", "紧凑": "Compact", "文字大小": "Text size", "标准": "Standard", "较大": "Large", "恢复默认": "Reset preferences", "账号与安全": "Account & security",
  "偏好即时生效，保存在当前浏览器，按账号独立记忆。": "Changes apply immediately and are saved per account in this browser.",
  "中英文切换适用于全部操作界面；用户录入的业务内容保留原文。": "Language changes apply throughout the interface. User-entered business content retains its original language.",
  "浏览器未允许保存偏好，本次设置仍生效。": "Browser storage is unavailable. Changes apply to this session only.",
  "选择项目": "Select a project", "本地工作空间": "Local workspace", "开发预览": "Preview", "下载使用指南": "Download guide", "新建": "Create", "刷新数据": "Refresh data",
};
export const PreferencesContext = createContext(defaultPreferences);
export function useInterface() {
  const preferences = useContext(PreferencesContext);
  return { ...preferences, t: (text: string) => preferences.language === "en" ? english[text] || translateUiText(text) : text };
}
