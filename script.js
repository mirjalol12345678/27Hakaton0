(() => {
  "use strict";

  const normalizeApiBase = (base) => String(base || "").trim().replace(/\/+$/, "");
  const expandApiCandidates = (base) => {
    const normalized = normalizeApiBase(base);
    if (!normalized) return [];
    if (normalized.endsWith("/api")) {
      return [normalized];
    }
    return [normalized, `${normalized}/api`];
  };

  const sameOriginApiBase =
    window.location.protocol === "http:" || window.location.protocol === "https:"
      ? normalizeApiBase(`${window.location.origin}/api`)
      : "";
  const isLocalHost =
    window.location.protocol === "file:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const isHttpOrigin =
    window.location.protocol === "http:" || window.location.protocol === "https:";
  const isProductionHost = isHttpOrigin && !isLocalHost;
  const metaConfiguredApiBaseRaw = normalizeApiBase(
    document.querySelector('meta[name="hakaton-api-base"]')?.getAttribute("content") || ""
  );
  const windowConfiguredApiBaseRaw = normalizeApiBase(window.HAKATON_API_URL || "");
  const API_OVERRIDE_FLAG_KEY = "hakaton_api_override";
  const configuredApiBaseRaw = normalizeApiBase(localStorage.getItem("hakaton_api_url"));
  const isStorageOverrideExplicit =
    String(localStorage.getItem(API_OVERRIDE_FLAG_KEY) || "").trim() === "1";
  const configuredApiBase =
    configuredApiBaseRaw && configuredApiBaseRaw !== sameOriginApiBase ? configuredApiBaseRaw : "";
  const storageConfiguredApiBase =
    configuredApiBase && (isLocalHost || isStorageOverrideExplicit) ? configuredApiBase : "";
  const storageConfiguredApiBaseSet = new Set(
    expandApiCandidates(storageConfiguredApiBase).map(normalizeApiBase).filter(Boolean)
  );
  const API_BASES = Array.from(
    new Set(
      [
        sameOriginApiBase,
        metaConfiguredApiBaseRaw,
        windowConfiguredApiBaseRaw,
        storageConfiguredApiBase,
        ...(isProductionHost ? [] : ["http://localhost:5000/api"])
      ]
        .flatMap(expandApiCandidates)
        .map(normalizeApiBase)
        .filter(Boolean)
    )
  );
  let activeApiBase =
    API_BASES[0] ||
    (isProductionHost ? sameOriginApiBase : "http://localhost:5000/api");
  const K_USER_TOKEN = "hakaton_user_token";
  const K_USER = "hakaton_user_data";
  const K_ADMIN_TOKEN = "hakaton_admin_token";
  const K_LOCAL_DB = "hakaton_local_demo_db_v1";
  const LOCAL_ADMIN_TOKEN_PREFIX = "local-admin:";
  const LOCAL_ADMIN_PASSWORD_HASH =
    "3bd62f7f9ccb2821f5330bd3a68629ed8b8a1a19370adf7d74636e76a698d430";

  const $app = document.getElementById("app");
  const $actions = document.getElementById("topbarActions");
  const $toast = document.getElementById("toast");
  let usingLocalDemoApi = false;

  const state = {
    user: loadJson(K_USER),
    tests: [],
    testSections: [],
    currentTest: null,
    adminUsers: [],
    adminSections: [],
    adminSectionTests: [],
    adminAttempts: [],
    adminActiveSectionId: "",
    adminTab: "users",
    adminUserSearch: "",
    adminAttemptSearch: "",
    editingTestId: "",
    editingUser: null,
    loading: false
  };

  function loadJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (_e) {
      return null;
    }
  }

  function hasExplicitApiOverride() {
    return String(localStorage.getItem(API_OVERRIDE_FLAG_KEY) || "").trim() === "1";
  }

  function isStorageOverrideBase(base) {
    return storageConfiguredApiBaseSet.has(normalizeApiBase(base));
  }

  function clearStoredApiOverride(reason) {
    const storedBase = normalizeApiBase(localStorage.getItem("hakaton_api_url"));
    const hasExplicit = hasExplicitApiOverride();
    const shouldClear = hasExplicit || (storedBase && storedBase !== sameOriginApiBase);
    if (!shouldClear) {
      return;
    }

    localStorage.removeItem("hakaton_api_url");
    localStorage.removeItem(API_OVERRIDE_FLAG_KEY);
    console.warn("[API] LocalStorage API override o'chirildi:", reason);
  }

  function persistWorkingApiBase(base) {
    const normalized = normalizeApiBase(base);
    if (!normalized) {
      return;
    }

    const explicitOverrideEnabled = hasExplicitApiOverride();
    if (normalized === sameOriginApiBase || isLocalHost || explicitOverrideEnabled) {
      localStorage.setItem("hakaton_api_url", normalized);
    }
  }

  function getUserToken() {
    return localStorage.getItem(K_USER_TOKEN) || "";
  }

  function getAdminToken() {
    return localStorage.getItem(K_ADMIN_TOKEN) || "";
  }

  function setUserSession(token, user) {
    localStorage.setItem(K_USER_TOKEN, token);
    localStorage.setItem(K_USER, JSON.stringify(user));
    state.user = user;
  }

  function clearUserSession() {
    localStorage.removeItem(K_USER_TOKEN);
    localStorage.removeItem(K_USER);
    state.user = null;
    state.tests = [];
    state.currentTest = null;
  }

  function setAdminToken(token) {
    localStorage.setItem(K_ADMIN_TOKEN, token);
  }

  function clearAdminToken() {
    localStorage.removeItem(K_ADMIN_TOKEN);
    state.adminUsers = [];
    state.adminSections = [];
    state.adminSectionTests = [];
    state.adminAttempts = [];
    state.adminActiveSectionId = "";
    state.adminTab = "users";
    state.adminUserSearch = "";
    state.adminAttemptSearch = "";
    state.editingTestId = "";
  }

  function toast(type, text) {
    $toast.className = `toast ${type}`;
    $toast.textContent = text;
    setTimeout(() => ($toast.className = "toast hidden"), 2800);
  }

  function h(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanText(value) {
    return String(value || "").trim();
  }

  async function sha256Hex(value) {
    if (!window.crypto || !window.crypto.subtle) {
      return String(value || "") === "0809" ? LOCAL_ADMIN_PASSWORD_HASH : "invalid-hash";
    }
    const text = new TextEncoder().encode(String(value || ""));
    const hash = await window.crypto.subtle.digest("SHA-256", text);
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function normalizePhone(phone) {
    const digits = cleanText(phone).replace(/\D/g, "");
    if (!digits) return "";
    return `+${digits}`;
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function createDefaultLocalDb() {
    return {
      users: [],
      sections: [],
      tests: [],
      testAttempts: [],
      verificationCodes: {}
    };
  }

  function readLocalDb() {
    let db = loadJson(K_LOCAL_DB);
    if (!db || typeof db !== "object") {
      db = createDefaultLocalDb();
      localStorage.setItem(K_LOCAL_DB, JSON.stringify(db));
      return db;
    }

    if (!Array.isArray(db.users)) db.users = [];
    db.users = db.users.map((user) => ({
      ...user,
      status: ["pending", "passed", "failed"].includes(cleanText(user.status))
        ? cleanText(user.status)
        : "pending",
      statusNote: cleanText(user.statusNote)
    }));
    if (!Array.isArray(db.sections)) db.sections = [];
    if (!Array.isArray(db.tests)) db.tests = [];
    if (
      db.tests.length === 1 &&
      (db.tests[0]?.title === "Demo test" || db.tests[0]?.title === "Namunaviy test") &&
      db.tests[0]?.description === "Demo rejim uchun namunaviy test"
    ) {
      db.tests = [];
    }
    if (db.sections.length === 1 && db.sections[0]?.name === "Demo bo'lim") {
      db.sections = [];
    }

    if (db.tests.length > 0 && db.sections.length === 0) {
      const defaultSectionId = makeId();
      db.sections.push({
        id: defaultSectionId,
        name: "Umumiy bo'lim",
        description: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      db.tests = db.tests.map((test) => ({ ...test, sectionId: defaultSectionId }));
    }

    const validSectionIds = new Set(db.sections.map((item) => item.id));
    if (db.tests.some((test) => !test.sectionId || !validSectionIds.has(test.sectionId))) {
      let fallback = db.sections[0];
      if (!fallback) {
        fallback = {
          id: makeId(),
          name: "Umumiy bo'lim",
          description: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        db.sections.push(fallback);
        validSectionIds.add(fallback.id);
      }
      db.tests = db.tests.map((test) =>
        test.sectionId && validSectionIds.has(test.sectionId)
          ? test
          : { ...test, sectionId: fallback.id }
      );
    }
    if (!Array.isArray(db.testAttempts)) db.testAttempts = [];
    db.testAttempts = db.testAttempts.map((attempt) => ({
      ...attempt,
      reviewStatus: ["pending", "passed", "failed"].includes(cleanText(attempt.reviewStatus))
        ? cleanText(attempt.reviewStatus)
        : "pending",
      reviewNote: cleanText(attempt.reviewNote),
      reviewedAt: attempt.reviewedAt || null
    }));
    if (!db.verificationCodes || typeof db.verificationCodes !== "object") db.verificationCodes = {};
    localStorage.setItem(K_LOCAL_DB, JSON.stringify(db));
    return db;
  }

  function writeLocalDb(db) {
    localStorage.setItem(K_LOCAL_DB, JSON.stringify(db));
  }

  function getLocalPublicUser(user) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      className: user.className,
      phone: user.phone,
      status: user.status,
      statusNote: user.statusNote || ""
    };
  }

  function getLocalSectionById(db, sectionId) {
    return db.sections.find((item) => item.id === sectionId) || null;
  }

  function buildLocalSectionPayload(section) {
    return {
      id: section.id,
      name: section.name,
      description: section.description || "",
      createdAt: section.createdAt
    };
  }

  function buildLocalTestPayload(test) {
    return {
      id: test.id,
      title: test.title,
      description: test.description || "",
      isActive: test.isActive !== false,
      questionCount: Array.isArray(test.questions) ? test.questions.length : 0,
      createdAt: test.createdAt
    };
  }

  function buildLocalSectionsWithTests(db) {
    return db.sections
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((section) => {
        const tests = db.tests
          .filter((test) => test.sectionId === section.id && test.isActive !== false)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map(buildLocalTestPayload);
        return {
          ...buildLocalSectionPayload(section),
          testCount: tests.length,
          tests
        };
      });
  }

  function upsertLocalUser(db, data, phone) {
    let user = db.users.find((item) => item.phone === phone);
    if (!user) {
      user = {
        id: makeId(),
        firstName: data.firstName,
        lastName: data.lastName,
        className: data.className,
        phone,
        telegramChatId: null,
        status: "pending",
        statusNote: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.users.push(user);
      return user;
    }

    user.firstName = data.firstName;
    user.lastName = data.lastName;
    user.className = data.className;
    if (!Object.prototype.hasOwnProperty.call(user, "statusNote")) {
      user.statusNote = "";
    }
    user.updatedAt = new Date().toISOString();
    return user;
  }

  function createApiError(status, message, payload = null) {
    const err = new Error(message);
    err.status = status;
    err.payload = payload;
    return err;
  }

  function statusToUzbek(status) {
    if (status === "passed") return "o'tdi";
    if (status === "failed") return "o'tmadi";
    return "kutilmoqda";
  }

  function statusFromUzbekInput(value) {
    const v = cleanText(value).toLowerCase();
    if (!v) return "";
    if (v === "pending" || v === "kutilmoqda") return "pending";
    if (v === "passed" || v === "otdi" || v === "o'tdi" || v === "oʻtdi") return "passed";
    if (v === "failed" || v === "otmadi" || v === "o'tmadi" || v === "oʻtmadi") return "failed";
    return v;
  }

  function formatDateTime(dateValue) {
    if (!dateValue) return "-";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return String(dateValue);
    return date.toLocaleString("uz-UZ", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function enableLocalDemoMode() {
    if (usingLocalDemoApi) return;
    usingLocalDemoApi = true;
  }

  function requireLocalAdmin(token) {
    const value = cleanText(token);
    if (value.startsWith(LOCAL_ADMIN_TOKEN_PREFIX)) {
      return true;
    }
    throw createApiError(401, "Admin uchun ruxsat yo'q yoki sessiya tugagan.");
  }

  function requireLocalUser(token, db) {
    const prefix = "local-user:";
    if (token && token.startsWith(prefix)) {
      const id = token.slice(prefix.length);
      const user = db.users.find((item) => item.id === id);
      if (user) {
        return user;
      }
    }

    const cachedUserRaw = state.user || loadJson(K_USER);
    if (cachedUserRaw && cachedUserRaw.phone) {
      const normalizedPhone = normalizePhone(cachedUserRaw.phone);
      const cachedData = {
        firstName: cleanText(cachedUserRaw.firstName),
        lastName: cleanText(cachedUserRaw.lastName),
        className: cleanText(cachedUserRaw.className),
        phone: normalizedPhone
      };
      if (cachedData.firstName && cachedData.lastName && cachedData.className && cachedData.phone) {
        const user = upsertLocalUser(db, cachedData, normalizedPhone);
        user.status = cleanText(cachedUserRaw.status) || user.status || "pending";
        user.statusNote = cleanText(cachedUserRaw.statusNote) || user.statusNote || "";
        writeLocalDb(db);

        const publicUser = getLocalPublicUser(user);
        state.user = publicUser;
        localStorage.setItem(K_USER, JSON.stringify(publicUser));
        localStorage.setItem(K_USER_TOKEN, `local-user:${user.id}`);
        return user;
      }
    }

    throw createApiError(401, "Ruxsat yo'q yoki sessiya muddati tugagan.");
  }

  async function apiLocal(path, { method = "GET", token = "", body = null } = {}) {
    enableLocalDemoMode();
    const db = readLocalDb();
    const normalizedMethod = String(method || "GET").toUpperCase();
    const parsed = new URL(path, "http://local.api");
    const pathname = parsed.pathname;

    if (pathname === "/auth/direct-register" && normalizedMethod === "POST") {
      const firstName = cleanText(body?.firstName);
      const lastName = cleanText(body?.lastName);
      const className = cleanText(body?.className);
      const phone = normalizePhone(body?.phone);

      if (!firstName || !lastName || !className || !phone) {
        throw createApiError(400, "Barcha maydonlar to'ldirilishi kerak");
      }
      if (firstName.length < 2 || lastName.length < 2) {
        throw createApiError(400, "Ism va familiya kamida 2 ta belgidan iborat bo'lishi kerak");
      }

      const user = upsertLocalUser(
        db,
        {
          firstName,
          lastName,
          className
        },
        phone
      );
      writeLocalDb(db);

      return {
        success: true,
        message: "Ro'yxatdan o'tdingiz",
        token: `local-user:${user.id}`,
        user: getLocalPublicUser(user)
      };
    }

    if (pathname === "/auth/request-code" && normalizedMethod === "POST") {
      const firstName = cleanText(body?.firstName);
      const lastName = cleanText(body?.lastName);
      const className = cleanText(body?.className);
      const phone = normalizePhone(body?.phone);

      if (!firstName || !lastName || !className || !phone) {
        throw createApiError(400, "Barcha maydonlar to'ldirilishi kerak");
      }
      if (firstName.length < 2 || lastName.length < 2) {
        throw createApiError(400, "Ism va familiya kamida 2 ta belgidan iborat bo'lishi kerak");
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      db.verificationCodes[phone] = {
        code,
        attemptsLeft: 5,
        expiresAt: Date.now() + 10 * 60 * 1000,
        registrationData: { firstName, lastName, className }
      };
      writeLocalDb(db);

      return {
        success: true,
        message: "Kod yuborildi.",
        demoCode: code
      };
    }

    if (pathname === "/auth/verify-code" && normalizedMethod === "POST") {
      const phone = normalizePhone(body?.phone);
      const code = cleanText(body?.code).replace(/[^\d]/g, "");
      if (code.length !== 6) {
        throw createApiError(400, "6 xonali kodni kiriting");
      }

      const verification = db.verificationCodes[phone];
      if (!verification) {
        throw createApiError(400, "Kod topilmadi yoki muddati tugagan");
      }
      if (verification.expiresAt < Date.now()) {
        delete db.verificationCodes[phone];
        writeLocalDb(db);
        throw createApiError(400, "Kod muddati tugagan");
      }
      if (verification.code !== code) {
        verification.attemptsLeft -= 1;
        if (verification.attemptsLeft <= 0) {
          delete db.verificationCodes[phone];
          writeLocalDb(db);
          throw createApiError(400, "Kod noto'g'ri. Limit tugadi, qayta kod yuboring");
        }
        db.verificationCodes[phone] = verification;
        writeLocalDb(db);
        throw createApiError(400, `Kod noto'g'ri. Qolgan urinishlar: ${verification.attemptsLeft}`);
      }

      let user = db.users.find((item) => item.phone === phone);
      if (!user) {
        user = {
          id: makeId(),
          firstName: verification.registrationData.firstName,
          lastName: verification.registrationData.lastName,
          className: verification.registrationData.className,
          phone,
          telegramChatId: null,
          status: "pending",
          statusNote: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        db.users.push(user);
      } else {
        user.firstName = verification.registrationData.firstName;
        user.lastName = verification.registrationData.lastName;
        user.className = verification.registrationData.className;
        if (!Object.prototype.hasOwnProperty.call(user, "statusNote")) {
          user.statusNote = "";
        }
        user.updatedAt = new Date().toISOString();
      }

      delete db.verificationCodes[phone];
      writeLocalDb(db);

      return {
        success: true,
        message: "Ro'yxatdan o'tdingiz",
        token: `local-user:${user.id}`,
        user: getLocalPublicUser(user)
      };
    }

    if (pathname === "/users/me" && normalizedMethod === "GET") {
      const user = requireLocalUser(token, db);
      return { success: true, user: getLocalPublicUser(user) };
    }

    if (pathname === "/tests" && normalizedMethod === "GET") {
      requireLocalUser(token, db);
      const sections = buildLocalSectionsWithTests(db);
      return { success: true, sections };
    }

    const getTestMatch = pathname.match(/^\/tests\/([^/]+)$/);
    if (getTestMatch && normalizedMethod === "GET") {
      requireLocalUser(token, db);
      const testId = decodeURIComponent(getTestMatch[1]);
      const test = db.tests.find((item) => item.id === testId && item.isActive !== false);
      if (!test) throw createApiError(404, "Test topilmadi");
      return {
        success: true,
        test: {
          id: test.id,
          title: test.title,
          description: test.description,
          questions: test.questions.map((question) => ({
            id: question.id,
            text: question.text,
            options: {
              A: question.optionA,
              B: question.optionB,
              C: question.optionC,
              D: question.optionD
            }
          }))
        }
      };
    }

    const submitTestMatch = pathname.match(/^\/tests\/([^/]+)\/submit$/);
    if (submitTestMatch && normalizedMethod === "POST") {
      const user = requireLocalUser(token, db);
      const testId = decodeURIComponent(submitTestMatch[1]);
      const test = db.tests.find((item) => item.id === testId && item.isActive !== false);
      if (!test) throw createApiError(404, "Test topilmadi");

      const answers = body?.answers;
      if (!answers || typeof answers !== "object") {
        throw createApiError(400, "Javoblar yuborilmadi");
      }

      let correctCount = 0;
      const totalQuestions = test.questions.length;
      const normalizedAnswers = {};
      test.questions.forEach((question) => {
        const answer = cleanText(answers[question.id]).toUpperCase();
        normalizedAnswers[question.id] = answer;
        if (["A", "B", "C", "D"].includes(answer) && answer === question.correctAnswer) {
          correctCount += 1;
        }
      });

      const scorePercent = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
      user.status = "pending";
      user.statusNote = "";
      user.updatedAt = new Date().toISOString();

      db.testAttempts.push({
        id: makeId(),
        userId: user.id,
        testId,
        answers: normalizedAnswers,
        correctCount,
        totalQuestions,
        scorePercent,
        passed: scorePercent === 100,
        reviewStatus: "pending",
        reviewNote: "",
        reviewedAt: null,
        createdAt: new Date().toISOString()
      });

      writeLocalDb(db);
      return {
        success: true,
        message: "Javoblaringiz yuborildi. Natija admin tomonidan tekshiriladi.",
        result: { correctCount, totalQuestions, scorePercent, passed: null }
      };
    }

    if (pathname === "/admin/login" && normalizedMethod === "POST") {
      const password = cleanText(body?.password);
      if (!password) {
        throw createApiError(400, "Parol majburiy");
      }

      const passwordHash = await sha256Hex(password);
      if (passwordHash !== LOCAL_ADMIN_PASSWORD_HASH) {
        throw createApiError(401, "Parol noto'g'ri");
      }

      return {
        success: true,
        token: `${LOCAL_ADMIN_TOKEN_PREFIX}${Date.now()}`,
        admin: {
          id: "local-admin",
          username: "admin"
        }
      };
    }

    if (pathname === "/admin/users" && normalizedMethod === "GET") {
      requireLocalAdmin(token);
      const search = cleanText(parsed.searchParams.get("search")).toLowerCase();
      const users = db.users
        .filter((user) => {
          if (!search) return true;
          return (
            user.firstName.toLowerCase().includes(search) ||
            user.lastName.toLowerCase().includes(search) ||
            user.className.toLowerCase().includes(search) ||
            user.phone.toLowerCase().includes(search) ||
            cleanText(user.statusNote).toLowerCase().includes(search)
          );
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((user) => ({
          _id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          className: user.className,
          phone: user.phone,
          status: user.status,
          statusNote: user.statusNote || "",
          createdAt: user.createdAt
        }));
      return { success: true, users };
    }

    if (pathname === "/admin/attempts" && normalizedMethod === "GET") {
      requireLocalAdmin(token);
      const search = cleanText(parsed.searchParams.get("search")).toLowerCase();
      const attempts = db.testAttempts
        .map((attempt) => {
          const user = db.users.find((item) => item.id === attempt.userId) || null;
          const test = db.tests.find((item) => item.id === attempt.testId) || null;
          const section = test ? getLocalSectionById(db, test.sectionId) : null;
          return {
            id: attempt.id,
            userId: attempt.userId,
            userName: user ? `${user.firstName} ${user.lastName}`.trim() : "Noma'lum foydalanuvchi",
            userClassName: user?.className || "-",
            userPhone: user?.phone || "-",
            userStatus: user?.status || "pending",
            userStatusNote: user?.statusNote || "",
            testId: attempt.testId,
            testTitle: test?.title || "O'chirilgan test",
            sectionName: section?.name || "Bo'limsiz",
            correctCount: Number(attempt.correctCount || 0),
            totalQuestions: Number(attempt.totalQuestions || 0),
            scorePercent: Number(attempt.scorePercent || 0),
            submittedAt: attempt.createdAt,
            reviewStatus: cleanText(attempt.reviewStatus) || "pending",
            reviewNote: cleanText(attempt.reviewNote),
            reviewedAt: attempt.reviewedAt || null
          };
        })
        .filter((item) => {
          if (!search) return true;
          return (
            item.userName.toLowerCase().includes(search) ||
            item.userClassName.toLowerCase().includes(search) ||
            item.userPhone.toLowerCase().includes(search) ||
            item.testTitle.toLowerCase().includes(search) ||
            item.sectionName.toLowerCase().includes(search)
          );
        })
        .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
      return { success: true, attempts };
    }

    const adminAttemptReviewMatch = pathname.match(/^\/admin\/attempts\/([^/]+)\/review$/);
    if (adminAttemptReviewMatch && normalizedMethod === "POST") {
      requireLocalAdmin(token);
      const attemptId = decodeURIComponent(adminAttemptReviewMatch[1]);
      const attempt = db.testAttempts.find((item) => item.id === attemptId);
      if (!attempt) {
        throw createApiError(404, "Test natijasi topilmadi");
      }

      const status = cleanText(body?.status).toLowerCase();
      const note = cleanText(body?.note);
      if (!["pending", "passed", "failed"].includes(status)) {
        throw createApiError(400, "Holat noto'g'ri");
      }
      if (status === "failed" && !note) {
        throw createApiError(400, "O'tmadi holati uchun izoh yozing");
      }

      attempt.reviewStatus = status;
      attempt.reviewNote = status === "failed" ? note : "";
      attempt.reviewedAt = new Date().toISOString();
      attempt.reviewedBy = "admin-local";

      const user = db.users.find((item) => item.id === attempt.userId);
      if (user) {
        user.status = status;
        user.statusNote = attempt.reviewNote;
        user.updatedAt = new Date().toISOString();
      }

      writeLocalDb(db);
      return {
        success: true,
        message: "Natija saqlandi",
        attempt: {
          id: attempt.id,
          reviewStatus: attempt.reviewStatus,
          reviewNote: attempt.reviewNote,
          reviewedAt: attempt.reviewedAt
        }
      };
    }

    if (pathname === "/admin/sections" && normalizedMethod === "GET") {
      requireLocalAdmin(token);
      const sections = buildLocalSectionsWithTests(db).map((section) => ({
        id: section.id,
        name: section.name,
        description: section.description,
        testCount: section.testCount,
        createdAt: section.createdAt
      }));
      return { success: true, sections };
    }

    if (pathname === "/admin/sections" && normalizedMethod === "POST") {
      requireLocalAdmin(token);
      const name = cleanText(body?.name);
      const description = cleanText(body?.description);
      if (!name) {
        throw createApiError(400, "Bo'lim nomi majburiy");
      }
      const duplicate = db.sections.find(
        (section) => section.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        throw createApiError(400, "Bu bo'lim nomi allaqachon mavjud");
      }

      const section = {
        id: makeId(),
        name,
        description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.sections.push(section);
      writeLocalDb(db);
      return {
        success: true,
        message: "Bo'lim yaratildi",
        section: {
          ...buildLocalSectionPayload(section),
          testCount: 0
        }
      };
    }

    const adminSectionTestsMatch = pathname.match(/^\/admin\/sections\/([^/]+)\/tests$/);
    if (adminSectionTestsMatch && normalizedMethod === "GET") {
      requireLocalAdmin(token);
      const sectionId = decodeURIComponent(adminSectionTestsMatch[1]);
      const section = getLocalSectionById(db, sectionId);
      if (!section) {
        throw createApiError(404, "Bo'lim topilmadi");
      }

      const tests = db.tests
        .filter((test) => test.sectionId === sectionId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((test) => ({
          ...buildLocalTestPayload(test),
          questions: test.questions.map((question) => ({
            id: question.id,
            text: question.text,
            optionA: question.optionA,
            optionB: question.optionB,
            optionC: question.optionC,
            optionD: question.optionD,
            correctAnswer: question.correctAnswer
          }))
        }));
      return {
        success: true,
        section: buildLocalSectionPayload(section),
        tests
      };
    }

    const prepareQuestionsFromBody = (payload) => {
      if (Array.isArray(payload?.questions) && payload.questions.length > 0) {
        return payload.questions.map((question, index) => {
          const text = cleanText(question?.text);
          const optionA = cleanText(question?.optionA);
          const optionB = cleanText(question?.optionB);
          const optionC = cleanText(question?.optionC);
          const optionD = cleanText(question?.optionD);
          const correctAnswer = cleanText(question?.correctAnswer).toUpperCase();
          if (!text || !optionA || !optionB || !optionC || !optionD) {
            throw createApiError(400, `${index + 1}-savol maydonlari to'liq emas`);
          }
          if (!["A", "B", "C", "D"].includes(correctAnswer)) {
            throw createApiError(400, `${index + 1}-savol uchun to'g'ri javob noto'g'ri`);
          }
          return {
            id: makeId(),
            text,
            optionA,
            optionB,
            optionC,
            optionD,
            correctAnswer
          };
        });
      }

      const text = cleanText(payload?.questionText || payload?.text);
      const optionA = cleanText(payload?.optionA);
      const optionB = cleanText(payload?.optionB);
      const optionC = cleanText(payload?.optionC);
      const optionD = cleanText(payload?.optionD || payload?.optionE);
      const correctAnswer = cleanText(payload?.correctAnswer).toUpperCase();
      if (!text || !optionA || !optionB || !optionC || !optionD) {
        throw createApiError(400, "Savol va variantlar to'liq kiritilishi kerak");
      }
      if (!["A", "B", "C", "D"].includes(correctAnswer)) {
        throw createApiError(400, "To'g'ri javob noto'g'ri tanlangan");
      }
      return [
        {
          id: makeId(),
          text,
          optionA,
          optionB,
          optionC,
          optionD,
          correctAnswer
        }
      ];
    };

    if (adminSectionTestsMatch && normalizedMethod === "POST") {
      requireLocalAdmin(token);
      const sectionId = decodeURIComponent(adminSectionTestsMatch[1]);
      const section = getLocalSectionById(db, sectionId);
      if (!section) {
        throw createApiError(404, "Bo'lim topilmadi");
      }

      const existingInSection = db.tests.filter(
        (test) => test.sectionId === sectionId && test.isActive !== false
      ).length;
      if (existingInSection >= 7) {
        throw createApiError(400, "Bu bo'limda 7 tadan ortiq test bo'lishi mumkin emas");
      }

      const title = cleanText(body?.title) || `${section.name} testi ${existingInSection + 1}`;
      const description = cleanText(body?.description);
      const questions = prepareQuestionsFromBody(body);

      const test = {
        id: makeId(),
        sectionId,
        title,
        description,
        isActive: true,
        createdBy: "admin-local",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        questions
      };
      db.tests.push(test);
      writeLocalDb(db);

      return {
        success: true,
        message: "Test saqlandi",
        test: {
          ...buildLocalTestPayload(test),
          sectionId
        }
      };
    }

    const adminSectionMatch = pathname.match(/^\/admin\/sections\/([^/]+)$/);
    if (adminSectionMatch && normalizedMethod === "PUT") {
      requireLocalAdmin(token);
      const sectionId = decodeURIComponent(adminSectionMatch[1]);
      const section = getLocalSectionById(db, sectionId);
      if (!section) {
        throw createApiError(404, "Bo'lim topilmadi");
      }

      const nextName = cleanText(body?.name) || section.name;
      const nextDescription = cleanText(body?.description);
      if (!nextName) {
        throw createApiError(400, "Bo'lim nomi majburiy");
      }
      const duplicate = db.sections.find(
        (item) => item.id !== sectionId && item.name.toLowerCase() === nextName.toLowerCase()
      );
      if (duplicate) {
        throw createApiError(400, "Bu bo'lim nomi allaqachon mavjud");
      }

      section.name = nextName;
      section.description = nextDescription;
      section.updatedAt = new Date().toISOString();
      writeLocalDb(db);

      return {
        success: true,
        message: "Bo'lim yangilandi",
        section: {
          ...buildLocalSectionPayload(section),
          testCount: db.tests.filter((test) => test.sectionId === sectionId).length
        }
      };
    }

    if (adminSectionMatch && normalizedMethod === "DELETE") {
      requireLocalAdmin(token);
      const sectionId = decodeURIComponent(adminSectionMatch[1]);
      const sectionIndex = db.sections.findIndex((item) => item.id === sectionId);
      if (sectionIndex === -1) {
        throw createApiError(404, "Bo'lim topilmadi");
      }

      const removedTestIds = db.tests
        .filter((test) => test.sectionId === sectionId)
        .map((test) => test.id);
      db.sections.splice(sectionIndex, 1);
      db.tests = db.tests.filter((test) => test.sectionId !== sectionId);
      db.testAttempts = db.testAttempts.filter(
        (attempt) => !removedTestIds.includes(attempt.testId)
      );
      writeLocalDb(db);
      return { success: true, message: "Bo'lim o'chirildi" };
    }

    const adminUserMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && normalizedMethod === "PUT") {
      requireLocalAdmin(token);
      const id = decodeURIComponent(adminUserMatch[1]);
      const user = db.users.find((item) => item.id === id);
      if (!user) throw createApiError(404, "Foydalanuvchi topilmadi");

      if (Object.prototype.hasOwnProperty.call(body || {}, "firstName")) {
        user.firstName = cleanText(body.firstName);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, "lastName")) {
        user.lastName = cleanText(body.lastName);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, "className")) {
        user.className = cleanText(body.className);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, "status")) {
        user.status = cleanText(body.status);
      }
      if (Object.prototype.hasOwnProperty.call(body || {}, "statusNote")) {
        user.statusNote = cleanText(body.statusNote);
      }

      if (!["pending", "passed", "failed"].includes(user.status)) {
        throw createApiError(400, "Status noto'g'ri");
      }
      if (user.status === "failed" && !cleanText(user.statusNote)) {
        throw createApiError(400, "O'tmadi holati uchun izoh kiriting");
      }
      if (user.status !== "failed") {
        user.statusNote = "";
      }
      if (user.firstName.length < 2) {
        throw createApiError(400, "Ism kamida 2 ta belgi bo'lishi kerak");
      }
      if (user.lastName.length < 2) {
        throw createApiError(400, "Familiya kamida 2 ta belgi bo'lishi kerak");
      }

      user.updatedAt = new Date().toISOString();
      writeLocalDb(db);
      return {
        success: true,
        message: "Foydalanuvchi yangilandi",
        user: {
          _id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          className: user.className,
          phone: user.phone,
          status: user.status,
          statusNote: user.statusNote || ""
        }
      };
    }

    if (adminUserMatch && normalizedMethod === "DELETE") {
      requireLocalAdmin(token);
      const id = decodeURIComponent(adminUserMatch[1]);
      const index = db.users.findIndex((item) => item.id === id);
      if (index === -1) throw createApiError(404, "Foydalanuvchi topilmadi");

      db.users.splice(index, 1);
      db.testAttempts = db.testAttempts.filter((attempt) => attempt.userId !== id);
      writeLocalDb(db);
      return { success: true, message: "Foydalanuvchi o'chirildi" };
    }

    if (pathname === "/admin/tests" && normalizedMethod === "GET") {
      requireLocalAdmin(token);
      const tests = db.tests
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((test) => ({
          ...buildLocalTestPayload(test),
          sectionId: test.sectionId,
          sectionName: getLocalSectionById(db, test.sectionId)?.name || "Bo'limsiz"
        }));
      return { success: true, tests };
    }

    if (pathname === "/admin/tests" && normalizedMethod === "POST") {
      requireLocalAdmin(token);
      const title = cleanText(body?.title);
      const description = cleanText(body?.description);
      let sectionId = cleanText(body?.sectionId);
      if (!sectionId) {
        const fallbackSection =
          db.sections[0] ||
          (() => {
            const created = {
              id: makeId(),
              name: "Umumiy bo'lim",
              description: "",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            db.sections.push(created);
            return created;
          })();
        sectionId = fallbackSection.id;
      }
      const section = getLocalSectionById(db, sectionId);
      if (!section) {
        throw createApiError(404, "Bo'lim topilmadi");
      }

      const inSection = db.tests.filter(
        (test) => test.sectionId === sectionId && test.isActive !== false
      ).length;
      if (inSection >= 7) {
        throw createApiError(400, "Bu bo'limda 7 tadan ortiq test bo'lishi mumkin emas");
      }

      if (!title) throw createApiError(400, "Test nomi majburiy");
      const preparedQuestions = prepareQuestionsFromBody(body);

      const test = {
        id: makeId(),
        sectionId,
        title,
        description,
        isActive: true,
        createdBy: "admin-local",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        questions: preparedQuestions
      };
      db.tests.push(test);
      writeLocalDb(db);
      return {
        success: true,
        message: "Test saqlandi",
        test: {
          ...buildLocalTestPayload(test),
          sectionId
        }
      };
    }

    const adminTestMatch = pathname.match(/^\/admin\/tests\/([^/]+)$/);
    if (adminTestMatch && normalizedMethod === "PUT") {
      requireLocalAdmin(token);
      const testId = decodeURIComponent(adminTestMatch[1]);
      const test = db.tests.find((item) => item.id === testId);
      if (!test) {
        throw createApiError(404, "Test topilmadi");
      }

      const nextTitle = cleanText(body?.title) || test.title;
      const nextDescription = cleanText(body?.description);
      const nextSectionId = cleanText(body?.sectionId) || test.sectionId;
      const section = getLocalSectionById(db, nextSectionId);
      if (!section) {
        throw createApiError(404, "Bo'lim topilmadi");
      }

      if (nextSectionId !== test.sectionId) {
        const inSection = db.tests.filter(
          (item) => item.sectionId === nextSectionId && item.id !== test.id && item.isActive !== false
        ).length;
        if (inSection >= 7) {
          throw createApiError(400, "Bu bo'limda 7 tadan ortiq test bo'lishi mumkin emas");
        }
      }

      const bodyHasQuestionPayload =
        Object.prototype.hasOwnProperty.call(body || {}, "questionText") ||
        Object.prototype.hasOwnProperty.call(body || {}, "optionA") ||
        Object.prototype.hasOwnProperty.call(body || {}, "correctAnswer") ||
        Array.isArray(body?.questions);

      if (bodyHasQuestionPayload) {
        const temp = {
          ...body,
          questions: Array.isArray(body?.questions)
            ? body.questions
            : [
              {
                text: body?.questionText,
                optionA: body?.optionA,
                optionB: body?.optionB,
                optionC: body?.optionC,
                optionD: body?.optionD || body?.optionE,
                correctAnswer: body?.correctAnswer
              }
            ]
        };
        const validated = temp.questions.map((question, index) => {
          const text = cleanText(question?.text);
          const optionA = cleanText(question?.optionA);
          const optionB = cleanText(question?.optionB);
          const optionC = cleanText(question?.optionC);
          const optionD = cleanText(question?.optionD);
          const correctAnswer = cleanText(question?.correctAnswer).toUpperCase();
          if (!text || !optionA || !optionB || !optionC || !optionD) {
            throw createApiError(400, `${index + 1}-savol maydonlari to'liq emas`);
          }
          if (!["A", "B", "C", "D"].includes(correctAnswer)) {
            throw createApiError(400, `${index + 1}-savol uchun to'g'ri javob noto'g'ri`);
          }
          return {
            id: question?.id || makeId(),
            text,
            optionA,
            optionB,
            optionC,
            optionD,
            correctAnswer
          };
        });
        test.questions = validated;
      }

      test.title = nextTitle;
      test.description = nextDescription;
      test.sectionId = nextSectionId;
      test.updatedAt = new Date().toISOString();
      writeLocalDb(db);

      return {
        success: true,
        message: "Test yangilandi",
        test: {
          ...buildLocalTestPayload(test),
          sectionId: test.sectionId
        }
      };
    }

    if (adminTestMatch && normalizedMethod === "DELETE") {
      requireLocalAdmin(token);
      const testId = decodeURIComponent(adminTestMatch[1]);
      const index = db.tests.findIndex((item) => item.id === testId);
      if (index === -1) {
        throw createApiError(404, "Test topilmadi");
      }

      db.tests.splice(index, 1);
      db.testAttempts = db.testAttempts.filter((attempt) => attempt.testId !== testId);
      writeLocalDb(db);
      return { success: true, message: "Test o'chirildi" };
    }

    throw createApiError(404, "So'rov manzili topilmadi");
  }

  async function api(path, { method = "GET", token = "", body = null } = {}) {
    const isDirectRegisterPath = path === "/auth/direct-register";
    const isAdminPath = String(path || "").startsWith("/admin");
    const isLocalAdminToken = cleanText(token).startsWith(LOCAL_ADMIN_TOKEN_PREFIX);
    const canUseLocalFallback =
      isLocalHost && (!isAdminPath || path === "/admin/login" || isLocalAdminToken);

    if (usingLocalDemoApi && canUseLocalFallback) {
      return apiLocal(path, { method, token, body });
    }

    const requestCandidates = API_BASES.map((base) => ({
      base,
      url: `${base}${path}`,
      mode: "path"
    }));

    if (isProductionHost && sameOriginApiBase) {
      requestCandidates.push({
        base: sameOriginApiBase,
        url: `${window.location.origin}/api?__path=${encodeURIComponent(String(path || ""))}`,
        mode: "query"
      });
    }

    let res;
    let responseBase = "";
    try {
      let lastNetworkError = null;
      let response = null;
      let firstHttpResponse = null;
      let firstHttpBase = "";
      let shouldClearStoredOverride = false;
      const networkDiagnostics = [];

      for (let i = 0; i < requestCandidates.length; i += 1) {
        const candidate = requestCandidates[i];
        const base = candidate.base;
        try {
          const controller =
            typeof AbortController === "function" ? new AbortController() : null;
          const timeoutId = controller ? setTimeout(() => controller.abort(), 12000) : null;
          let current;
          try {
            current = await fetch(candidate.url, {
              method,
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
              },
              body: body ? JSON.stringify(body) : undefined,
              signal: controller ? controller.signal : undefined
            });
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }

          const contentType = String(current.headers.get("content-type") || "").toLowerCase();
          const isJsonResponse = contentType.includes("application/json");
          networkDiagnostics.push({
            base,
            url: candidate.url,
            mode: candidate.mode,
            type: "http",
            status: current.status,
            contentType
          });

          if (
            isStorageOverrideBase(base) &&
            (current.status === 404 || current.status === 405 || !isJsonResponse)
          ) {
            shouldClearStoredOverride = true;
          }

          if (!firstHttpResponse) {
            firstHttpResponse = current;
            firstHttpBase = base;
          }
          const shouldTryNext =
            i < requestCandidates.length - 1 &&
            (current.status === 404 ||
              current.status === 405 ||
              current.status === 301 ||
              current.status === 302 ||
              current.status === 307 ||
              current.status === 308 ||
              !isJsonResponse);

          if (shouldTryNext) {
            continue;
          }

          response = current;
          activeApiBase = base;
          responseBase = base;
          break;
        } catch (error) {
          lastNetworkError = error;
          networkDiagnostics.push({
            base,
            url: candidate.url,
            mode: candidate.mode,
            type: "network",
            errorName: error?.name || "Error",
            errorMessage: String(error?.message || "")
          });
          if (isStorageOverrideBase(base)) {
            shouldClearStoredOverride = true;
          }
        }
      }

      if (!response) {
        if (firstHttpResponse) {
          response = firstHttpResponse;
          activeApiBase = firstHttpBase || activeApiBase;
          responseBase = firstHttpBase || responseBase;
        } else {
          if (shouldClearStoredOverride) {
            clearStoredApiOverride("network-failure");
          }
          console.warn("[API] Network-level reject", {
            path,
            method,
            activeApiBase,
            diagnostics: networkDiagnostics
          });
          throw lastNetworkError || new Error("Tarmoq xatoligi");
        }
      }

      res = response;
    } catch (networkError) {
      if (canUseLocalFallback) {
        return apiLocal(path, { method, token, body });
      }

      const rawErrorText = String(networkError?.message || "").toLowerCase();
      const isTimeout =
        networkError?.name === "AbortError" ||
        rawErrorText.includes("timeout") ||
        rawErrorText.includes("vaqt");
      const isOffline =
        typeof navigator !== "undefined" &&
        Object.prototype.hasOwnProperty.call(navigator, "onLine") &&
        navigator.onLine === false;
      const mixedContentRisk =
        window.location.protocol === "https:" &&
        requestCandidates.some((candidate) =>
          String(candidate.base || "").startsWith("http://")
        );
      const usedStorageOverride = requestCandidates.some((candidate) =>
        isStorageOverrideBase(candidate.base)
      );

      if (usedStorageOverride) {
        clearStoredApiOverride("network-reject");
      }

      let networkMessage = "Backendga ulanib bo'lmadi. Vercel'da API funksiyalar deploy bo'lganini tekshiring.";
      if (isTimeout) {
        networkMessage = "So'rov vaqti tugadi. Qayta urinib ko'ring.";
      } else if (isOffline) {
        networkMessage = "Internet ulanmagan. Internetni yoqib qayta urinib ko'ring.";
      } else if (usedStorageOverride) {
        networkMessage = "API override noto'g'ri bo'lishi mumkin. Sozlamani yangilab qayta urinib ko'ring.";
      } else if (mixedContentRisk) {
        networkMessage =
          "Brauzer xavfsizlik cheklovi sabab so'rov bloklandi. HTTPS backenddan foydalaning.";
      } else if (isDirectRegisterPath) {
        networkMessage =
          "Ro'yxatdan o'tishda backendga ulanib bo'lmadi. Internet yoki webview cheklovini tekshiring.";
      } else if (isAdminPath) {
        networkMessage = "Admin backendiga ulanib bo'lmadi. API holatini tekshiring.";
      }

      const err = new Error(networkMessage);
      err.status = isTimeout ? 408 : 503;
      console.warn("[API] Request failed before HTTP response", {
        path,
        method,
        activeApiBase,
        isTimeout,
        isOffline,
        mixedContentRisk,
        usedStorageOverride,
        errorName: networkError?.name || "Error",
        errorMessage: String(networkError?.message || "")
      });
      throw err;
    }

    let payload = null;
    let rawText = "";
    const responseType = String(res.headers.get("content-type") || "").toLowerCase();
    const isJson = responseType.includes("application/json");
    if (isJson) {
      try {
        payload = await res.json();
      } catch (_e) {
        payload = null;
      }
    } else {
      try {
        rawText = (await res.text()) || "";
      } catch (_e) {
        rawText = "";
      }
    }

    if (!res.ok || (payload && payload.success === false)) {
      const shouldUseLocalByStatus =
        canUseLocalFallback &&
        (
          res.status === 404 ||
          res.status === 405 ||
          res.status === 408 ||
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504 ||
          res.status >= 500 ||
          (
            path === "/admin/login" &&
            (res.status === 401 || res.status === 403)
          )
        );
      if (shouldUseLocalByStatus) {
        return apiLocal(path, { method, token, body });
      }

      const shouldUseLocalForMissingAdminSectionApi =
        res.status === 404 &&
        (
          path.startsWith("/admin/sections") ||
          path.startsWith("/admin/attempts") ||
          /^\/admin\/tests\/[^/]+$/.test(path)
        );
      if (shouldUseLocalForMissingAdminSectionApi && canUseLocalFallback) {
        return apiLocal(path, { method, token, body });
      }

      if (
        isStorageOverrideBase(responseBase || activeApiBase) &&
        (
          res.status === 404 ||
          res.status === 405 ||
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504
        )
      ) {
        clearStoredApiOverride(`http-${res.status}`);
      }

      if (
        isAdminPath &&
        !canUseLocalFallback &&
        (
          res.status === 404 ||
          res.status === 405 ||
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504 ||
          res.status >= 500
        )
      ) {
        const adminErr = new Error("Admin backendi ishlamayapti yoki topilmadi. API holatini tekshiring.");
        adminErr.status = res.status === 404 || res.status === 405 ? 404 : 503;
        throw adminErr;
      }

      let message = payload?.message || rawText.trim();

      if (isDirectRegisterPath && (res.status === 404 || res.status === 405)) {
        message = "Backend API topilmadi. Vercel'da API funksiyalar deploy bo'lganini tekshiring.";
      } else if (
        isDirectRegisterPath &&
        (res.status === 502 || res.status === 503 || res.status === 504 || res.status >= 500)
      ) {
        message = "Backend ishlamayapti, keyinroq qayta urinib ko'ring.";
      }

      if (!message) {
        if (res.status === 404) {
          message = "So'rov manzili topilmadi. Backend manzilini tekshiring.";
        } else if (res.status === 405) {
          message = "API endpoint mos emas (405). Backend URL to'g'ri emas bo'lishi mumkin.";
        } else if (res.status === 408) {
          message = "So'rov vaqti tugadi. Internet yoki backend holatini tekshiring.";
        } else if (res.status === 422) {
          message = "Yuborilgan ma'lumotlar backend tomonidan qabul qilinmadi (422).";
        } else if (res.status === 429) {
          message = "Juda ko'p urinish bo'ldi. Birozdan keyin qayta urinib ko'ring.";
        } else if (res.status === 403) {
          message = "Ushbu amal uchun ruxsat yo'q.";
        } else if (res.status === 502 || res.status === 503 || res.status === 504) {
          message = "Backend vaqtincha mavjud emas. Bir ozdan keyin qayta urinib ko'ring.";
        } else if (res.status >= 500) {
          message = "Server ichki xatoligi. Keyinroq qayta urinib ko'ring.";
        } else if (res.status === 401) {
          message = "Ruxsat yo'q yoki sessiya muddati tugagan.";
        } else if (res.status === 400) {
          message = "So'rov ma'lumotlari noto'g'ri yuborildi.";
        } else {
          message = `Noma'lum javob qaytdi (HTTP ${res.status}). API: ${activeApiBase || "aniqlanmadi"}`;
        }
      }

      const err = new Error(message);
      err.status = res.status;
      err.payload = payload;
      console.warn("[API] HTTP error response", {
        path,
        method,
        status: res.status,
        base: responseBase || activeApiBase,
        message
      });
      throw err;
    }

    if (!isJson) {
      if (canUseLocalFallback) {
        return apiLocal(path, { method, token, body });
      }
      const err = new Error(
        path === "/auth/direct-register"
          ? "Backend API topilmadi. Vercel'da API funksiyalar deploy bo'lganini tekshiring."
          : "Server noto'g'ri javob qaytardi. Backend manzilini tekshiring."
      );
      err.status = 502;
      if (isStorageOverrideBase(responseBase || activeApiBase)) {
        clearStoredApiOverride("non-json-response");
      }
      throw err;
    }

    persistWorkingApiBase(responseBase || activeApiBase);
    return payload;
  }

  function route() {
    const hash = window.location.hash || "#register";
    if (hash.startsWith("#test/")) return { page: "test", id: hash.slice(6) };
    if (hash === "#profile") return { page: "profile" };
    if (hash === "#admin-login") return { page: "admin-login" };
    if (hash === "#admin") return { page: "admin" };
    return { page: "register" };
  }

  function statusHtml(status, adminMode = false) {
    if (status === "passed") return `<span class="status status-pass">${adminMode ? "O'tdi" : "Testdan o'tgan"}</span>`;
    if (status === "failed") return `<span class="status status-fail">${adminMode ? "O'tmadi" : "Testdan o'tmagan"}</span>`;
    return '<span class="status status-pending">Kutilmoqda</span>';
  }

  function setLoading(v) {
    state.loading = v;
    renderTopbar();
  }

  function renderTopbar() {
    const r = route();
    const hasAdmin = Boolean(getAdminToken());
    const hasSession = Boolean(getUserToken() || getAdminToken());
    const items = [];

    if (!hasAdmin) {
      items.push('<button class="btn btn-outline" id="goAdminLogin">Admin panelga kirish</button>');
    }
    if (hasAdmin && r.page !== "admin") {
      items.push('<button class="btn btn-outline" id="goAdmin">Admin panel</button>');
    }
    if (hasSession) items.push('<button class="btn btn-outline" id="logoutUser">Chiqish</button>');

    $actions.innerHTML = items.join("");
    document.getElementById("goAdminLogin")?.addEventListener("click", () => {
      location.hash = "#admin-login";
    });
    document.getElementById("goAdmin")?.addEventListener("click", () => {
      location.hash = "#admin";
    });
    document.getElementById("logoutUser")?.addEventListener("click", () => {
      clearUserSession();
      clearAdminToken();
      location.hash = "#register";
      toast("success", "Chiqildi");
    });
  }

  function renderRegister() {
    $app.innerHTML = `
      <section class="hero-grid register-hero">
        <article class="register-copy stack">
          <h1 class="title title-lg">27-maktab hakaton uchun royhatdan oting</h1>
        </article>

        <article class="card card-pad register-panel" id="regSection">
          <div class="row">
            <h2 class="title register-form-title">Ro'yxatdan o'tish</h2>
          </div>
          <form id="regForm" class="stack">
            <input class="field" name="firstName" placeholder="Ism" required />
            <input class="field" name="lastName" placeholder="Familiya" required />
            <input class="field" name="className" placeholder="Nechanchi sinf (masalan 9-A)" required />
            <input class="field" name="phone" placeholder="Telefon (+998901234567)" required />
            <button class="btn btn-main btn-block">Ro'yxatdan o'tish</button>
          </form>
        </article>
      </section>
    `;

    const regForm = document.getElementById("regForm");
    regForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const body = {
        firstName: String(fd.get("firstName") || "").trim(),
        lastName: String(fd.get("lastName") || "").trim(),
        className: String(fd.get("className") || "").trim(),
        phone: String(fd.get("phone") || "").trim()
      };
      setLoading(true);
      try {
        const r = await api("/auth/direct-register", { method: "POST", body });
        setUserSession(r.token, r.user);
        toast("success", r.message || "Ro'yxatdan o'tdingiz");
        location.hash = "#profile";
      } catch (err) {
        toast("error", err.message);
      } finally {
        setLoading(false);
      }
    });

  }

  async function renderProfile() {
    const token = getUserToken();
    if (!token) return (location.hash = "#register");
    $app.innerHTML = '<article class="card card-pad"><span class="loader"><span></span><span></span><span></span></span></article>';
    setLoading(true);
    try {
      const [me, tests] = await Promise.all([api("/users/me", { token }), api("/tests", { token })]);
      state.user = me.user;
      if (Array.isArray(tests.sections)) {
        state.testSections = tests.sections;
        state.tests = tests.sections.flatMap((section) => section.tests || []);
      } else {
        state.tests = tests.tests || [];
        state.testSections = state.tests.length
          ? [
            {
              id: "all",
              name: "Barcha testlar",
              tests: state.tests
            }
          ]
          : [];
      }
      localStorage.setItem(K_USER, JSON.stringify(state.user));
    } catch (err) {
      if (err.status === 401) {
        clearUserSession();
        location.hash = "#register";
      }
      toast("error", err.message);
      setLoading(false);
      return;
    }
    setLoading(false);

    const t = state.testSections
      .map((section) => {
        const sectionTests = Array.isArray(section.tests) ? section.tests : [];
        const items = sectionTests
          .map((x) => `
            <article class="test-card">
              <h4 style="margin:0 0 6px;">${h(x.title)}</h4>
              <p class="muted" style="margin:0 0 8px;">${h(x.description || "Ta'rif yo'q")}</p>
              <p class="muted" style="margin:0 0 8px;">Savollar: <b>${x.questionCount}</b></p>
              <button class="btn btn-main btn-block startTest" data-id="${x.id}">Testni boshlash</button>
            </article>
          `)
          .join("");
        return `
          <article class="test-card stack">
            <div class="row">
              <h3 style="margin:0;">${h(section.name || "Bo'lim")}</h3>
              <span class="badge">${sectionTests.length} ta test</span>
            </div>
            ${items || '<p class="muted">Bu bo\'limda test yo\'q.</p>'}
          </article>
        `;
      })
      .join("");

    const fullName = `${h(state.user.firstName)} ${h(state.user.lastName)}`.trim();
    const initial = h(String(state.user.firstName || "F").trim().slice(0, 1).toUpperCase());
    const phoneText = h(state.user.phone || "Telefon kiritilmagan");
    const reviewNote = cleanText(state.user.statusNote);
    const isFailed = state.user.status === "failed";
    const statusInfo =
      state.user.status === "passed"
        ? "Admin holati: O'tdingiz"
        : state.user.status === "failed"
          ? "Admin holati: O'tmadingiz"
          : "Admin holati: Tekshiruvda";

    $app.innerHTML = `
      <section class="stack profile-page">
        <h1 class="title title-lg">Foydalanuvchi profili</h1>
        <article class="card card-pad profile-hero-card">
          <div class="profile-hero-header">
            <div class="profile-avatar">${initial}</div>
            <div class="profile-hero-headtext">
              <h2 class="title profile-fullname">${fullName}</h2>
              <p class="muted profile-headline">Xush kelibsiz</p>
              <p class="muted profile-headline">${phoneText}</p>
              <p class="muted profile-headline">${h(statusInfo)}</p>
            </div>
          </div>
          <div class="profile-hero-divider"></div>
          <div class="profile-hero-grid">
            <article class="profile-info-tile">
              <p class="profile-label">Sinf</p>
              <p class="profile-value">${h(state.user.className)}</p>
            </article>
            <article class="profile-info-tile">
              <p class="profile-label">Telefon</p>
              <p class="profile-value profile-phone-value">${phoneText}</p>
            </article>
          </div>
        </article>
        ${reviewNote
        ? `
              <article class="card card-pad ${isFailed ? "review-note-fail" : "review-note-pass"}">
                <p class="profile-label">Admin izohi</p>
                <p class="review-note-text">${h(reviewNote)}</p>
              </article>
            `
        : ""
      }
        <article class="card card-pad stack profile-tests-card">
          <div class="row"><h2 class="title" style="font-size:1.2rem;margin:0;">Mavjud testlar</h2><span class="badge">${state.tests.length} ta</span></div>
          <div class="test-grid">${t || '<p class="muted">Hozircha testlar yo\'q.</p>'}</div>
        </article>
      </section>
    `;

    document.querySelectorAll(".startTest").forEach((btn) => {
      btn.addEventListener("click", () => (location.hash = `#test/${btn.dataset.id}`));
    });
  }

  async function renderTest(id) {
    const token = getUserToken();
    if (!token) return (location.hash = "#register");
    $app.innerHTML = '<article class="card card-pad"><span class="loader"><span></span><span></span><span></span></span></article>';
    setLoading(true);
    try {
      const r = await api(`/tests/${id}`, { token });
      state.currentTest = r.test;
    } catch (err) {
      toast("error", err.message);
      location.hash = "#profile";
      setLoading(false);
      return;
    }
    setLoading(false);

    const qs = state.currentTest.questions
      .map((q, i) => `
        <article class="test-card stack">
          <p style="margin:0;font-weight:700;">${i + 1}. ${h(q.text)}</p>
          <div class="option-grid">
            ${["A", "B", "C", "D"]
          .map((k) => `<label class="option"><input style="display:none;" type="radio" name="q_${q.id}" value="${k}" /> <b>${k})</b> ${h(q.options[k])}</label>`)
          .join("")}
          </div>
        </article>
      `)
      .join("");

    $app.innerHTML = `
      <section class="stack">
        <div class="row"><h1 class="title title-lg">Test topshirish</h1><button class="btn btn-outline" id="backProfile">Profilga qaytish</button></div>
        <article class="card card-pad stack">
          <h2 class="title" style="font-size:1.2rem;margin:0;">${h(state.currentTest.title)}</h2>
          <p class="muted" style="margin:0;">${h(state.currentTest.description || "Ta'rif yo'q")}</p>
          <form id="submitTest" class="stack">${qs}<button class="btn btn-main btn-block">Testni yakunlash</button></form>
        </article>
      </section>
    `;

    document.getElementById("backProfile").addEventListener("click", () => (location.hash = "#profile"));
    document.querySelectorAll(".option input").forEach((i) => {
      i.addEventListener("change", () => {
        document.querySelectorAll(`input[name="${i.name}"]`).forEach((x) => x.closest(".option").classList.toggle("active", x.checked));
      });
    });
    document.getElementById("submitTest").addEventListener("submit", async (e) => {
      e.preventDefault();
      const answers = {};
      state.currentTest.questions.forEach((q) => {
        const c = document.querySelector(`input[name="q_${q.id}"]:checked`);
        if (c) answers[q.id] = c.value;
      });
      setLoading(true);
      try {
        const r = await api(`/tests/${state.currentTest.id}/submit`, { method: "POST", token, body: { answers } });
        toast("success", r.message || "Javoblar yuborildi");
        location.hash = "#profile";
      } catch (err) {
        toast("error", err.message);
      } finally {
        setLoading(false);
      }
    });
  }

  function renderAdminLogin() {
    $app.innerHTML = `
      <section style="min-height:calc(100vh - 130px);display:grid;place-items:center;">
        <article class="card card-pad" style="width:min(460px,100%);">
          <h1 class="title title-lg" style="font-size:1.9rem;">Boshqaruv paneliga kirish</h1>
          <form id="adminLogin" class="stack">
            <input class="field" name="password" type="password" placeholder="Parol" required />
            <button class="btn btn-main btn-block">Kirish</button>
          </form>
        </article>
      </section>
    `;

    document.getElementById("adminLogin").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setLoading(true);
      try {
        const r = await api("/admin/login", {
          method: "POST",
          body: { password: String(fd.get("password") || "") }
        });
        setAdminToken(r.token);
        toast("success", "Boshqaruv paneliga kirildi");
        location.hash = "#admin";
      } catch (err) {
        toast("error", err.message);
      } finally {
        setLoading(false);
      }
    });
  }

  async function renderAdmin(userSearch = state.adminUserSearch || "", attemptSearch = state.adminAttemptSearch || "") {
    const token = getAdminToken();
    if (!token) return (location.hash = "#admin-login");
    state.adminUserSearch = cleanText(userSearch);
    state.adminAttemptSearch = cleanText(attemptSearch);
    $app.innerHTML = '<article class="card card-pad"><span class="loader"><span></span><span></span><span></span></span></article>';
    setLoading(true);
    try {
      const [u, s, a] = await Promise.all([
        api(
          state.adminUserSearch
            ? `/admin/users?search=${encodeURIComponent(state.adminUserSearch)}`
            : "/admin/users",
          { token }
        ),
        api("/admin/sections", { token }),
        api(
          state.adminAttemptSearch
            ? `/admin/attempts?search=${encodeURIComponent(state.adminAttemptSearch)}`
            : "/admin/attempts",
          { token }
        )
      ]);
      state.adminUsers = u.users || [];
      state.adminSections = s.sections || [];
      state.adminAttempts = a.attempts || [];

      if (!state.adminSections.some((section) => section.id === state.adminActiveSectionId)) {
        state.adminActiveSectionId = state.adminSections[0]?.id || "";
        state.editingTestId = "";
      }

      if (state.adminActiveSectionId) {
        const sectionTests = await api(`/admin/sections/${state.adminActiveSectionId}/tests`, { token });
        state.adminSectionTests = sectionTests.tests || [];
      } else {
        state.adminSectionTests = [];
      }
    } catch (err) {
      if (err.status === 401) {
        clearAdminToken();
        location.hash = "#admin-login";
      } else if (err.status === 503) {
        clearAdminToken();
        location.hash = "#admin-login";
        toast("error", "Admin sessiyasi yangilandi. Parolni qayta kiriting.");
        setLoading(false);
        return;
      }
      toast("error", err.message);
      setLoading(false);
      return;
    }
    setLoading(false);
    const autoFocusUserId = state.adminUserSearch && state.adminUsers.length ? state.adminUsers[0]._id : "";

    const users = state.adminUsers
      .map((u) => `
        <article class="test-card stack" data-user-card="${u._id}">
          <div class="row"><h3 style="margin:0;">${h(u.firstName)} ${h(u.lastName)}</h3>${statusHtml(u.status, true)}</div>
          <p class="muted" style="margin:0;">Sinf: ${h(u.className)}</p>
          <p class="muted" style="margin:0;">Telefon: ${h(u.phone)}</p>
          ${u.statusNote ? `<p class="admin-note-text" style="margin:0;">Izoh: ${h(u.statusNote)}</p>` : ""}
          <div class="row">
            <button class="btn btn-outline editUser" data-id="${u._id}">Tahrirlash</button>
            <button class="btn btn-danger delUser" data-id="${u._id}">O'chirish</button>
          </div>
        </article>
      `)
      .join("");

    const sections = state.adminSections
      .map((section) => `
        <article class="test-card stack">
          <div class="row">
            <h3 style="margin:0;">${h(section.name)}</h3>
            <span class="badge">${section.testCount}/7</span>
          </div>
          <p class="muted" style="margin:0;">${h(section.description || "Tavsif yo'q")}</p>
          <div class="row">
            <button class="btn btn-outline openSection" data-id="${section.id}">Ochish</button>
            <button class="btn btn-outline editSection" data-id="${section.id}">Tahrirlash</button>
            <button class="btn btn-danger delSection" data-id="${section.id}">O'chirish</button>
          </div>
        </article>
      `)
      .join("");

    const attempts = state.adminAttempts
      .map((attempt) => `
        <article class="test-card stack">
          <div class="row">
            <h3 style="margin:0;">${h(attempt.userName)}</h3>
            <span class="badge">${attempt.correctCount}/${attempt.totalQuestions}</span>
          </div>
          <p class="muted" style="margin:0;">Sinf: ${h(attempt.userClassName)} | Telefon: ${h(attempt.userPhone)}</p>
          <p class="muted" style="margin:0;">Bo'lim/Test: ${h(attempt.sectionName)} / ${h(attempt.testTitle)}</p>
          <p class="muted" style="margin:0;">Natija: ${attempt.correctCount} ta to'g'ri, ${attempt.totalQuestions} tadan (${attempt.scorePercent}%)</p>
          <p class="muted" style="margin:0;">Topshirilgan vaqt: ${h(formatDateTime(attempt.submittedAt))}</p>
          <div class="row">
            ${statusHtml(attempt.reviewStatus || "pending", true)}
            <span class="badge">${attempt.reviewedAt ? `Tekshirildi: ${h(formatDateTime(attempt.reviewedAt))}` : "Tekshiruv kutilmoqda"}</span>
          </div>
          ${attempt.reviewNote ? `<p class="admin-note-text" style="margin:0;">Admin izohi: ${h(attempt.reviewNote)}</p>` : ""}
          <div class="row">
            <button class="btn btn-outline reviewPassed" data-id="${attempt.id}">O'tdi</button>
            <button class="btn btn-danger reviewFailed" data-id="${attempt.id}">O'tmadi</button>
            <button class="btn btn-outline reviewPending" data-id="${attempt.id}">Kutilmoqda</button>
          </div>
        </article>
      `)
      .join("");

    const activeSection = state.adminSections.find(
      (section) => section.id === state.adminActiveSectionId
    );
    const sectionLimitReached =
      Boolean(activeSection) &&
      Number(activeSection?.testCount || 0) >= 7 &&
      !state.editingTestId;
    const editingTest = state.adminSectionTests.find(
      (test) => test.id === state.editingTestId
    );
    const editingQuestion = editingTest?.questions?.[0] || {};

    const sectionTests = state.adminSectionTests
      .map((test) => `
        <article class="test-card stack">
          <h3 style="margin:0;">${h(test.title)}</h3>
          <p class="muted" style="margin:0;">${h(test.description || "Tavsif yo'q")}</p>
          <p class="muted" style="margin:0;">Savollar: ${test.questionCount}</p>
          <div class="row">
            <button class="btn btn-outline editTest" data-id="${test.id}">Tahrirlash</button>
            <button class="btn btn-danger delTest" data-id="${test.id}">O'chirish</button>
          </div>
        </article>
      `)
      .join("");

    $app.innerHTML = `
      <section class="stack">
        <div class="row"><h1 class="title title-lg">Boshqaruv paneli</h1><div class="row"><button id="tabUsers" class="btn btn-outline">1. Foydalanuvchilar</button><button id="tabTests" class="btn btn-outline">2. Bo'lim va testlar</button><button id="tabAttempts" class="btn btn-outline">3. Test natijalari</button></div></div>
        <article class="card card-pad stack" id="usersPanel" style="${state.adminTab === "users" ? "display:grid;" : "display:none;"}">
          <form id="searchUsers" class="row"><input class="field" name="search" value="${h(state.adminUserSearch)}" placeholder="Ism yoki telefon bo'yicha qidiring" style="flex:1;min-width:220px;" /><button class="btn btn-main">Qidirish</button></form>
          <p class="muted" style="margin:0;">Qidirilganda mos foydalanuvchiga avtomatik olib boriladi.</p>
          ${users || '<p class="muted">Foydalanuvchi topilmadi.</p>'}
        </article>
        <section class="stack" id="testsPanel" style="${state.adminTab === "tests" ? "display:grid;" : "display:none;"}">
          <article class="card card-pad stack">
            <h2 class="title" style="font-size:1.2rem;margin:0;">1-qadam: Bo'lim yaratish</h2>
            <form id="createSection" class="stack">
              <input class="field" name="name" placeholder="Bo'lim nomi" required />
              <textarea class="field" name="description" rows="3" placeholder="Bo'lim tavsifi"></textarea>
              <button class="btn btn-main">Bo'limni saqlash</button>
            </form>
            <div class="stack">${sections || '<p class="muted">Hozircha bo\'limlar yo\'q.</p>'}</div>
          </article>
          <article class="card card-pad stack">
            <div class="row"><h2 class="title" style="font-size:1.2rem;margin:0;">2-qadam: Test qo'shish</h2><span class="badge">${activeSection ? h(activeSection.name) : "Bo'lim tanlanmagan"}</span></div>
            ${activeSection
        ? `
                  <p class="muted" style="margin:0;">Har bir bo'limga maksimal 7 ta test qo'shiladi.</p>
                  ${sectionLimitReached
          ? '<span class="status status-fail">Bu bo\'lim to\'lgan (7/7). Yangi test qo\'shish uchun avval bir testni o\'chiring.</span>'
          : ""
        }
                  <form id="upsertTest" class="stack">
                    <input class="field" name="title" placeholder="Test nomi" value="${h(editingTest?.title || "")}" required />
                    <textarea class="field" name="description" rows="2" placeholder="Test tavsifi">${h(editingTest?.description || "")}</textarea>
                    <p class="form-label">1. Savol matni</p>
                    <input class="field" name="questionText" placeholder="1-savol matni" value="${h(editingQuestion?.text || "")}" required />
                    <p class="form-label">2. Javob variantlari</p>
                    <input class="field" name="optionA" placeholder="A varianti" value="${h(editingQuestion?.optionA || "")}" required />
                    <input class="field" name="optionB" placeholder="B varianti" value="${h(editingQuestion?.optionB || "")}" required />
                    <input class="field" name="optionC" placeholder="C varianti" value="${h(editingQuestion?.optionC || "")}" required />
                    <input class="field" name="optionD" placeholder="D varianti" value="${h(editingQuestion?.optionD || "")}" required />
                    <p class="form-label">3. To'g'ri javobni belgilang</p>
                    <select class="field" name="correctAnswer" required>
                      <option value="">To'g'ri javobni tanlang</option>
                      <option value="A" ${editingQuestion?.correctAnswer === "A" ? "selected" : ""}>A</option>
                      <option value="B" ${editingQuestion?.correctAnswer === "B" ? "selected" : ""}>B</option>
                      <option value="C" ${editingQuestion?.correctAnswer === "C" ? "selected" : ""}>C</option>
                      <option value="D" ${editingQuestion?.correctAnswer === "D" ? "selected" : ""}>D</option>
                    </select>
                    <button class="btn btn-main" ${sectionLimitReached ? "disabled" : ""}>${state.editingTestId ? "Testni yangilash" : "Testni saqlash"}</button>
                    ${state.editingTestId
          ? '<button class="btn btn-outline" type="button" id="cancelTestEdit">Bekor qilish</button>'
          : ""
        }
                  </form>
                `
        : '<p class="muted">Avval bo\'lim yarating yoki bo\'limni tanlang.</p>'
      }
            <div class="stack">${sectionTests || '<p class="muted">Bu bo\'limda test yo\'q.</p>'}</div>
          </article>
        </section>
        <article class="card card-pad stack" id="attemptsPanel" style="${state.adminTab === "attempts" ? "display:grid;" : "display:none;"}">
          <form id="searchAttempts" class="row">
            <input class="field" name="search" value="${h(state.adminAttemptSearch)}" placeholder="Ism, telefon, test yoki bo'lim bo'yicha qidiring" style="flex:1;min-width:220px;" />
            <button class="btn btn-main">Qidirish</button>
          </form>
          <p class="muted" style="margin:0;">Bu bo'limda test ishlaganlar chiqadi. Natijaga qarab holatni belgilang.</p>
          ${attempts || '<p class="muted">Hozircha test ishlaganlar yo\'q.</p>'}
        </article>
      </section>
    `;

    const switchTab = (tab) => {
      state.adminTab = tab;
      document.getElementById("usersPanel").style.display = tab === "users" ? "grid" : "none";
      document.getElementById("testsPanel").style.display = tab === "tests" ? "grid" : "none";
      document.getElementById("attemptsPanel").style.display = tab === "attempts" ? "grid" : "none";
    };
    document.getElementById("tabUsers").addEventListener("click", () => switchTab("users"));
    document.getElementById("tabTests").addEventListener("click", () => switchTab("tests"));
    document.getElementById("tabAttempts").addEventListener("click", () => switchTab("attempts"));
    document.getElementById("searchUsers").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = String(new FormData(e.currentTarget).get("search") || "").trim();
      state.adminTab = "users";
      renderAdmin(v, state.adminAttemptSearch);
    });
    document.getElementById("searchAttempts")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = String(new FormData(e.currentTarget).get("search") || "").trim();
      state.adminTab = "attempts";
      renderAdmin(state.adminUserSearch, v);
    });

    document.querySelectorAll(".delUser").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Foydalanuvchini o'chirasizmi?")) return;
        setLoading(true);
        try {
          await api(`/admin/users/${btn.dataset.id}`, { method: "DELETE", token });
          toast("success", "Foydalanuvchi o'chirildi");
          renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
        } catch (err) {
          toast("error", err.message);
          setLoading(false);
        }
      });
    });

    document.querySelectorAll(".editUser").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const u = state.adminUsers.find((x) => x._id === btn.dataset.id);
        if (!u) return;
        const firstName = prompt("Ism", u.firstName); if (firstName === null) return;
        const lastName = prompt("Familiya", u.lastName); if (lastName === null) return;
        const className = prompt("Sinf", u.className); if (className === null) return;
        const statusInput = prompt("Holat (kutilmoqda/o'tdi/o'tmadi)", statusToUzbek(u.status));
        if (statusInput === null) return;
        const status = statusFromUzbekInput(statusInput);
        if (!["pending", "passed", "failed"].includes(status)) {
          return toast("error", "Holat noto'g'ri kiritildi");
        }
        let statusNote = "";
        if (status === "failed") {
          const noteInput = prompt("O'tmadi sababi (izoh)", u.statusNote || "");
          if (noteInput === null) return;
          statusNote = String(noteInput || "").trim();
          if (!statusNote) {
            return toast("error", "O'tmadi uchun izoh majburiy");
          }
        }
        setLoading(true);
        try {
          await api(`/admin/users/${u._id}`, {
            method: "PUT",
            token,
            body: { firstName, lastName, className, status, statusNote }
          });
          toast("success", "Foydalanuvchi yangilandi");
          renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
        } catch (err) {
          toast("error", err.message);
          setLoading(false);
        }
      });
    });

    document.getElementById("createSection")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setLoading(true);
      try {
        await api("/admin/sections", {
          method: "POST",
          token,
          body: {
            name: String(fd.get("name") || "").trim(),
            description: String(fd.get("description") || "").trim()
          }
        });
        state.adminTab = "tests";
        toast("success", "Bo'lim yaratildi");
        renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
      } catch (err) {
        toast("error", err.message);
        setLoading(false);
      }
    });

    document.querySelectorAll(".openSection").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.adminActiveSectionId = btn.dataset.id;
        state.adminTab = "tests";
        state.editingTestId = "";
        renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
      });
    });

    document.querySelectorAll(".editSection").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const section = state.adminSections.find((item) => item.id === btn.dataset.id);
        if (!section) return;
        const name = prompt("Bo'lim nomi", section.name);
        if (name === null) return;
        const description = prompt("Bo'lim tavsifi", section.description || "");
        if (description === null) return;
        setLoading(true);
        try {
          await api(`/admin/sections/${section.id}`, {
            method: "PUT",
            token,
            body: { name, description }
          });
          state.adminTab = "tests";
          toast("success", "Bo'lim yangilandi");
          renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
        } catch (err) {
          toast("error", err.message);
          setLoading(false);
        }
      });
    });

    document.querySelectorAll(".delSection").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Bo'lim va ichidagi testlarni o'chirasizmi?")) return;
        setLoading(true);
        try {
          await api(`/admin/sections/${btn.dataset.id}`, {
            method: "DELETE",
            token
          });
          if (state.adminActiveSectionId === btn.dataset.id) {
            state.adminActiveSectionId = "";
            state.editingTestId = "";
          }
          state.adminTab = "tests";
          toast("success", "Bo'lim o'chirildi");
          renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
        } catch (err) {
          toast("error", err.message);
          setLoading(false);
        }
      });
    });

    document.getElementById("upsertTest")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!state.adminActiveSectionId) {
        return toast("error", "Avval bo'lim tanlang");
      }
      const fd = new FormData(e.currentTarget);
      const body = {
        sectionId: state.adminActiveSectionId,
        title: String(fd.get("title") || "").trim(),
        description: String(fd.get("description") || "").trim(),
        questionText: String(fd.get("questionText") || "").trim(),
        optionA: String(fd.get("optionA") || "").trim(),
        optionB: String(fd.get("optionB") || "").trim(),
        optionC: String(fd.get("optionC") || "").trim(),
        optionD: String(fd.get("optionD") || "").trim(),
        correctAnswer: String(fd.get("correctAnswer") || "").trim().toUpperCase()
      };

      setLoading(true);
      try {
        if (state.editingTestId) {
          await api(`/admin/tests/${state.editingTestId}`, {
            method: "PUT",
            token,
            body
          });
          toast("success", "Test yangilandi");
        } else {
          await api(`/admin/sections/${state.adminActiveSectionId}/tests`, {
            method: "POST",
            token,
            body
          });
          toast("success", "Test saqlandi");
        }
        state.editingTestId = "";
        state.adminTab = "tests";
        renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
      } catch (err) {
        toast("error", err.message);
        setLoading(false);
      }
    });

    document.getElementById("cancelTestEdit")?.addEventListener("click", () => {
      state.editingTestId = "";
      state.adminTab = "tests";
      renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
    });

    document.querySelectorAll(".editTest").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.editingTestId = btn.dataset.id;
        state.adminTab = "tests";
        renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
      });
    });

    document.querySelectorAll(".delTest").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Testni o'chirasizmi?")) return;
        setLoading(true);
        try {
          await api(`/admin/tests/${btn.dataset.id}`, {
            method: "DELETE",
            token
          });
          if (state.editingTestId === btn.dataset.id) {
            state.editingTestId = "";
          }
          state.adminTab = "tests";
          toast("success", "Test o'chirildi");
          renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
        } catch (err) {
          toast("error", err.message);
          setLoading(false);
        }
      });
    });

    document.querySelectorAll(".reviewPassed").forEach((btn) => {
      btn.addEventListener("click", async () => {
        setLoading(true);
        try {
          await api(`/admin/attempts/${btn.dataset.id}/review`, {
            method: "POST",
            token,
            body: { status: "passed", note: "" }
          });
          state.adminTab = "attempts";
          toast("success", "Natija 'o'tdi' deb belgilandi");
          renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
        } catch (err) {
          toast("error", err.message);
          setLoading(false);
        }
      });
    });

    document.querySelectorAll(".reviewFailed").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const note = prompt("O'tmadi sababi (izoh) ni yozing:", "");
        if (note === null) return;
        const reason = String(note || "").trim();
        if (!reason) {
          return toast("error", "Izoh kiritish majburiy");
        }
        setLoading(true);
        try {
          await api(`/admin/attempts/${btn.dataset.id}/review`, {
            method: "POST",
            token,
            body: { status: "failed", note: reason }
          });
          state.adminTab = "attempts";
          toast("success", "Natija 'o'tmadi' deb belgilandi");
          renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
        } catch (err) {
          toast("error", err.message);
          setLoading(false);
        }
      });
    });

    document.querySelectorAll(".reviewPending").forEach((btn) => {
      btn.addEventListener("click", async () => {
        setLoading(true);
        try {
          await api(`/admin/attempts/${btn.dataset.id}/review`, {
            method: "POST",
            token,
            body: { status: "pending", note: "" }
          });
          state.adminTab = "attempts";
          toast("success", "Natija tekshiruvga qaytarildi");
          renderAdmin(state.adminUserSearch, state.adminAttemptSearch);
        } catch (err) {
          toast("error", err.message);
          setLoading(false);
        }
      });
    });

    if (autoFocusUserId && state.adminTab === "users") {
      const focusCard = document.querySelector(`[data-user-card="${autoFocusUserId}"]`);
      if (focusCard) {
        focusCard.classList.add("focus-card");
        focusCard.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => focusCard.classList.remove("focus-card"), 1800);
      }
    }
  }

  function render() {
    const r = route();
    renderTopbar();
    if (r.page === "register") return renderRegister();
    if (r.page === "profile") return renderProfile();
    if (r.page === "test") return renderTest(r.id);
    if (r.page === "admin-login") return renderAdminLogin();
    if (r.page === "admin") return renderAdmin();
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("DOMContentLoaded", () => {
    if (!location.hash) {
      if (getUserToken()) location.hash = "#profile";
      else if (getAdminToken()) location.hash = "#admin";
      else location.hash = "#register";
    } else {
      render();
    }
  });
})();

