import { Router } from "express";
import { pool } from "./db.ts";
import { isSystemAdmin, requireThat } from "./auth.ts";
import { verifyPasswordAsync } from "./security.ts";
export async function releaseReadiness() {
  const users = (
    await pool.query("SELECT id,username,password_hash,password_policy_version,provisioned_initial_password FROM users WHERE active")
  ).rows;
  const initial=users.filter(u=>u.provisioned_initial_password);
  const weak:string[]=[];for(const u of users){if(u.provisioned_initial_password)continue;if(u.password_policy_version<1||!/^\w{32}:[a-f0-9]{128}$/i.test(u.password_hash)){weak.push(u.username);continue;}for(const p of ['admin12345','admin123','password','123456789012'])if(await verifyPasswordAsync(p,u.password_hash)){weak.push(u.username);break;}}
  let origin = false;
  try {
    const u = new URL(process.env.PUBLIC_ORIGIN || "");
    origin =
      u.protocol === "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/";
  } catch {}
  const proxy = (process.env.TRUSTED_PROXY_CIDRS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    checks = [
      {
        id: "passwords",
        passed: weak.length === 0,
        title: "替换默认测试口令",
        detail: weak.length
          ? `请重置并分别设置强口令：${weak.join("、")}`
        : initial.length ? `${initial.length}个账号首次登录强制改密；改密前禁止访问业务API` : "账号已完成密码策略验证，未发现已知默认口令",
      },
      {
        id: "origin",
        passed: origin,
        title: "HTTPS公开入口",
        detail: "设置PUBLIC_ORIGIN为实际HTTPS域名，并在外部验证证书及可达性",
      },
      {
        id: "cookie",
        passed: process.env.COOKIE_SECURE === "true",
        title: "安全Cookie",
        detail: "正式发布使用COOKIE_SECURE=true；本机HTTP开发保留false",
      },
      {
        id: "proxy",
        passed:
          proxy.length > 0 &&
          !proxy.some((p) => ["0.0.0.0/0", "::/0", "*", "true"].includes(p)),
        title: "可信反向代理",
        detail: "仅信任实际代理地址，禁止信任任意来源",
      },
      {
        id: "demo",
        passed: process.env.SEED_DEMO === "false",
        title: "关闭演示初始化",
        detail: "正式发布设置SEED_DEMO=false，不删除已有业务数据",
      },
    ];
  return {
    ready: checks.every((c) => c.passed),
    mode: process.env.RELEASE_MODE === "true" ? "release" : "local",
    checks,
    notes: [
      "此检查不替代公网连通性、TLS证书和压力验收。",
      "请独立备份数据库与加密密钥，并进行恢复演练。",
    ],
  };
}
export const releaseRoutes = Router();
releaseRoutes.get("/system/release-readiness", async (req, res) => {
  requireThat(await isSystemAdmin(req.user.id));
  res.json(await releaseReadiness());
});
