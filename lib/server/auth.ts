import "server-only";

import {
  createHmac,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { OpsRole } from "@/lib/auth-types";

export type { OpsRole } from "@/lib/auth-types";

export const OPS_SESSION_COOKIE = "dalaieej_ops_session";
const SESSION_DURATION_SECONDS = 12 * 60 * 60;

export type OpsSession = {
  username: string;
  displayName: string;
  role: OpsRole;
  issuedAt: number;
  expiresAt: number;
};

type StoredAccount = {
  username: string;
  displayName: string;
  role: OpsRole;
  salt: string;
  passwordHash: string;
};

const ROLE_RANK: Record<OpsRole, number> = {
  cashier: 1,
  manager: 2,
  owner: 3,
};

function isRole(value: unknown): value is OpsRole {
  return value === "cashier" || value === "manager" || value === "owner";
}

function getSessionSecret() {
  const secret = process.env.OPS_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("OPS_SESSION_SECRET must contain at least 32 characters");
  }
  return secret;
}

function getAccounts(): StoredAccount[] {
  const raw = process.env.OPS_AUTH_ACCOUNTS;
  if (!raw) throw new Error("OPS_AUTH_ACCOUNTS is not configured");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OPS_AUTH_ACCOUNTS must be valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("OPS_AUTH_ACCOUNTS must be an array");
  }

  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`OPS_AUTH_ACCOUNTS[${index}] is invalid`);
    }

    const account = value as Partial<StoredAccount>;
    if (
      typeof account.username !== "string" ||
      typeof account.displayName !== "string" ||
      !isRole(account.role) ||
      typeof account.salt !== "string" ||
      typeof account.passwordHash !== "string"
    ) {
      throw new Error(`OPS_AUTH_ACCOUNTS[${index}] is incomplete`);
    }

    return {
      username: account.username.trim().toLowerCase(),
      displayName: account.displayName.trim(),
      role: account.role,
      salt: account.salt,
      passwordHash: account.passwordHash,
    };
  });
}

function encode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

export function createSessionToken(account: {
  username: string;
  displayName: string;
  role: OpsRole;
}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: OpsSession = {
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    issuedAt,
    expiresAt: issuedAt + SESSION_DURATION_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySessionToken(token: string | undefined | null) {
  if (!token) return null;
  const [encodedPayload, suppliedSignature, extra] = token.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return null;

  try {
    const expectedSignature = sign(encodedPayload);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<OpsSession>;
    if (
      typeof payload.username !== "string" ||
      typeof payload.displayName !== "string" ||
      !isRole(payload.role) ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload as OpsSession;
  } catch {
    return null;
  }
}

export function authenticateAccount(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const account = getAccounts().find(
    (candidate) => candidate.username === normalizedUsername,
  );
  if (!account) return null;

  const calculated = Buffer.from(
    scryptSync(password, Buffer.from(account.salt, "base64url"), 32),
  );
  const stored = Buffer.from(account.passwordHash, "base64url");
  if (calculated.length !== stored.length || !timingSafeEqual(calculated, stored)) {
    return null;
  }

  return {
    username: account.username,
    displayName: account.displayName,
    role: account.role,
  };
}

function parseCookieHeader(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  const entry = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OPS_SESSION_COOKIE}=`));
  return entry ? decodeURIComponent(entry.slice(OPS_SESSION_COOKIE.length + 1)) : null;
}

export function getRequestSession(request: Request) {
  return verifySessionToken(parseCookieHeader(request.headers.get("cookie")));
}

export async function getServerSession() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(OPS_SESSION_COOKIE)?.value);
}

export function hasMinimumRole(session: OpsSession, minimumRole: OpsRole) {
  return ROLE_RANK[session.role] >= ROLE_RANK[minimumRole];
}

export async function requirePageSession(
  nextPath: string,
  minimumRole: OpsRole = "cashier",
) {
  const session = await getServerSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!hasMinimumRole(session, minimumRole)) redirect("/");
  return session;
}

export function requireApiSession(
  request: Request,
  minimumRole: OpsRole = "cashier",
): OpsSession | NextResponse {
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json(
      { error: "Нэвтэрч орно уу.", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  if (!hasMinimumRole(session, minimumRole)) {
    return NextResponse.json(
      { error: "Энэ үйлдлийг хийх эрх хүрэлцэхгүй байна.", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  return session;
}

export function applySessionCookie(response: NextResponse, token: string) {
  response.cookies.set(OPS_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(OPS_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
