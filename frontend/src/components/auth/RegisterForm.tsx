/**
 * 注册表单（契约 `C-REGISTER-UI@1`）。
 *
 * 纯受控组件：`values` / `status` / `errorMessage` / `fieldErrors` 全部来自页面，
 * 组件内的本地状态只有「密码可见性」「大写锁定」等纯 UI 状态。本组件**不发起任何
 * 网络请求**，也不自己做校验（校验在 `registerFields.ts`，由 `useRegisterSubmit` 调用）。
 *
 * 可访问性：
 *  - 出错字段带 `aria-invalid="true"` 与 `aria-describedby` 指向字段级错误文案；
 *  - 错误汇总 `role="alert"`，出现时立即被读屏播报；
 *  - 提交中按钮 `disabled` 且文案为「正在创建账号…」；
 *  - 所有输入 id 统一 `register-` 前缀，避免与登录页 id 冲突。
 *
 * 隐私：密码只存在于受控 state，不写入任何持久化存储；本文件不 import `api`。
 */
import { useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  IDENTITY_TAGS,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  type IdentityTag,
  type RegisterFieldErrors,
  type RegisterFormValues,
} from './registerFields';
import type { RegisterStatus } from './useRegisterSubmit';

import styles from './RegisterForm.module.css';

/** 拼接局部类名：过滤掉 `undefined`，避免把字符串 "undefined" 写进 class 属性。 */
function joinClassNames(...names: ReadonlyArray<string | undefined>): string {
  return names.filter((name): name is string => Boolean(name)).join(' ');
}

export interface RegisterFormProps {
  values: RegisterFormValues;
  status: RegisterStatus;
  /** `status === 'error'` 时的汇总提示；其它状态为 null */
  errorMessage: string | null;
  /** 字段级错误文案（键为字段名） */
  fieldErrors: RegisterFieldErrors;
  onChange: (next: RegisterFormValues) => void;
  onSubmit: (values: RegisterFormValues) => void;
  /** mock 模式下显示演示说明，默认 false */
  mockMode?: boolean;
  /** 服务端返回「该邮箱已注册」时，在错误汇总内追加「去登录」链接 */
  duplicateEmail?: boolean;
  /** 服务端返回「该用户名已被占用」时，在字段下方给出提示 */
  duplicateUsername?: boolean;
  /** 账号服务状态提示（`unavailable` 时由页面传入） */
  serviceHint?: string | null;
}

const USERNAME_ID = 'register-username';
const EMAIL_ID = 'register-email';
const PASSWORD_ID = 'register-password';
const CONFIRM_PASSWORD_ID = 'register-confirm-password';
const DISPLAY_NAME_ID = 'register-display-name';
const IDENTITY_ID = 'register-identity';
const IDENTITY_HINT_ID = 'register-identity-hint';
const ERROR_ID = 'register-error';
const USERNAME_ERROR_ID = 'register-username-error';
const EMAIL_ERROR_ID = 'register-email-error';
const PASSWORD_ERROR_ID = 'register-password-error';
const CONFIRM_PASSWORD_ERROR_ID = 'register-confirm-password-error';
const DISPLAY_NAME_ERROR_ID = 'register-display-name-error';
const STRENGTH_ID = 'register-password-strength';

/** 把 `<select>` 的字符串值收窄回 `IdentityTag | ''`（禁止 `as` 硬转）。 */
function readIdentityTag(raw: string): IdentityTag | '' {
  const matched = IDENTITY_TAGS.find((tag) => tag.value === raw);
  return matched === undefined ? '' : matched.value;
}

/** 密码强度：0 空 / 1 太短 / 2 较弱 / 3 良好 / 4 很强。 */
function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password === '') return 0;
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) return 1;

  let score = 2;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score) as 2 | 3 | 4;
}

const STRENGTH_LABELS: Readonly<Record<0 | 1 | 2 | 3 | 4, string>> = {
  0: '',
  1: '太短',
  2: '较弱',
  3: '良好',
  4: '很强',
};

export function RegisterForm({
  values,
  status,
  errorMessage,
  fieldErrors,
  onChange,
  onSubmit,
  mockMode = false,
  duplicateEmail = false,
  duplicateUsername = false,
  serviceHint = null,
}: RegisterFormProps): JSX.Element {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const submitting = status === 'submitting';
  const hasError = status === 'error' && errorMessage !== null && errorMessage.length > 0;

  const usernameError = fieldErrors.username;
  const emailError = fieldErrors.email;
  const passwordError = fieldErrors.password;
  const confirmPasswordError = fieldErrors.confirmPassword;
  const displayNameError = fieldErrors.displayName;
  const strength = passwordStrength(values.password);
  const hasServiceHint = serviceHint !== null && serviceHint.trim() !== '';

  /* 汇总里的字段清单：顺序与表单一致，只列出真正有错的字段 */
  const fieldErrorItems: readonly { readonly key: string; readonly text: string }[] = [
    { key: 'username', text: usernameError ?? '' },
    { key: 'email', text: emailError ?? '' },
    { key: 'password', text: passwordError ?? '' },
    { key: 'confirmPassword', text: confirmPasswordError ?? '' },
    { key: 'displayName', text: displayNameError ?? '' },
  ].filter((item) => item.text !== '');

  const handleUsernameChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, username: event.target.value });
  };

  const handleEmailChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, email: event.target.value });
  };

  const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, password: event.target.value });
  };

  const handleConfirmPasswordChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, confirmPassword: event.target.value });
  };

  const handleDisplayNameChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, displayName: event.target.value });
  };

  const handleIdentityChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    onChange({ ...values, identityTag: readIdentityTag(event.target.value) });
  };

  /**
   * 切换密码可见性：只改本地 UI 状态，不清空输入、不触发表单提交。
   * `preventDefault()` 保证按钮即使位于表单内也不会诱发任何提交副作用。
   */
  const handleTogglePassword = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setShowPassword((current) => !current);
  };

  const handleToggleConfirmPassword = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setShowConfirmPassword((current) => !current);
  };

  const handlePasswordKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    setCapsLock(event.getModifierState('CapsLock'));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting || undefined} noValidate>
      <header className={styles.header}>
        <p className={styles.kicker}>Create account</p>
        <h1 className={styles.title}>创建账号</h1>
        <p className={styles.subtitle}>把材料、参数与运行记录留在自己的空间里</p>
      </header>

      {hasServiceHint ? (
        <p className={styles.serviceHint} role="status">
          {serviceHint}
        </p>
      ) : null}

      {mockMode ? (
        <p className={styles.mockHint}>演示模式：账号写入内存表，刷新页面后需要重新登录</p>
      ) : null}

      {/* 错误汇总：role="alert" 保证读屏在出现时立即播报 */}
      {hasError ? (
        <div className={styles.errorSummary} role="alert" id={ERROR_ID}>
          <p className={styles.errorTitle}>{errorMessage}</p>
          {duplicateEmail ? (
            <p className={styles.errorAction}>
              已有账号？
              <Link className={styles.errorLink} to="/login">
                去登录
              </Link>
            </p>
          ) : null}
          {fieldErrorItems.length > 0 ? (
            <ul className={styles.errorList}>
              {fieldErrorItems.map((item) => (
                <li key={item.key}>{item.text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={USERNAME_ID}>
            用户名<span className={styles.required} aria-hidden="true">*</span>
          </label>
          <div className={styles.inputShell}>
            <span className={styles.inputPrefix} aria-hidden="true">
              @
            </span>
            <input
              className={joinClassNames(styles.input, styles.inputWithPrefix)}
              id={USERNAME_ID}
              type="text"
              autoComplete="username"
              spellCheck={false}
              placeholder="例如：lin_teacher"
              required
              value={values.username}
              onChange={handleUsernameChange}
              aria-invalid={usernameError === undefined && !duplicateUsername ? undefined : 'true'}
              aria-describedby={
                usernameError === undefined && !duplicateUsername ? undefined : USERNAME_ERROR_ID
              }
            />
          </div>
          {usernameError === undefined ? (
            <p className={styles.hint}>
              {MIN_USERNAME_LENGTH}–{MAX_USERNAME_LENGTH} 位，字母开头
            </p>
          ) : (
            <p className={styles.fieldError} id={USERNAME_ERROR_ID}>
              {usernameError}
            </p>
          )}
          {duplicateUsername && usernameError === undefined ? (
            <p className={styles.fieldError} id={USERNAME_ERROR_ID}>
              该用户名已被占用，请换一个
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={EMAIL_ID}>
            邮箱<span className={styles.required} aria-hidden="true">*</span>
          </label>
          <div className={styles.inputShell}>
            <span className={styles.inputIcon} aria-hidden="true">
              <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
                <rect
                  x="2.6"
                  y="4.6"
                  width="14.8"
                  height="10.8"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="m3.4 6.2 6.6 4.6 6.6-4.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <input
              className={joinClassNames(styles.input, styles.inputWithIcon)}
              id={EMAIL_ID}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="请输入邮箱"
              required
              value={values.email}
              onChange={handleEmailChange}
              aria-invalid={emailError === undefined ? undefined : 'true'}
              aria-describedby={emailError === undefined ? undefined : EMAIL_ERROR_ID}
            />
          </div>
          {emailError === undefined ? (
            <p className={styles.hint}>用于登录与通知</p>
          ) : (
            <p className={styles.fieldError} id={EMAIL_ERROR_ID}>
              {emailError}
            </p>
          )}
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={PASSWORD_ID}>
            密码<span className={styles.required} aria-hidden="true">*</span>
          </label>
        <div className={styles.inputShell}>
          <span className={styles.inputIcon} aria-hidden="true">
            <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
              <rect
                x="4.2"
                y="8.6"
                width="11.6"
                height="8"
                rx="2.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M7 8.6V6.7a3 3 0 0 1 6 0v1.9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            className={joinClassNames(styles.input, styles.inputWithIcon, styles.passwordInput)}
            id={PASSWORD_ID}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
            required
            value={values.password}
            onChange={handlePasswordChange}
            onKeyDown={handlePasswordKey}
            onKeyUp={handlePasswordKey}
            onBlur={() => setCapsLock(false)}
            aria-invalid={passwordError === undefined ? undefined : 'true'}
            aria-describedby={
              passwordError === undefined ? STRENGTH_ID : `${PASSWORD_ERROR_ID} ${STRENGTH_ID}`
            }
          />
          <button
            type="button"
            className={styles.eyeToggle}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            title={showPassword ? '隐藏密码' : '显示密码'}
            aria-pressed={showPassword}
            aria-controls={PASSWORD_ID}
            onClick={handleTogglePassword}
          >
            {showPassword ? '隐藏' : '显示'}
          </button>
        </div>

        <div className={styles.strengthRow} id={STRENGTH_ID} aria-live="polite">
          <span className={styles.strengthTrack} data-level={strength} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className={styles.strengthLabel} data-level={strength}>
            {strength === 0 ? `至少 ${MIN_PASSWORD_LENGTH} 位` : `强度：${STRENGTH_LABELS[strength]}`}
          </span>
        </div>
        {capsLock ? (
          <p className={styles.capsHint} role="status">
            大写锁定已开启
          </p>
        ) : null}
        {passwordError === undefined ? null : (
          <p className={styles.fieldError} id={PASSWORD_ERROR_ID}>
            {passwordError}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={CONFIRM_PASSWORD_ID}>
          确认密码<span className={styles.required} aria-hidden="true">*</span>
        </label>
        <div className={styles.inputShell}>
          <span className={styles.inputIcon} aria-hidden="true">
            <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
              <path
                d="M10 2.4 16.4 5v4.4c0 3.8-2.6 6.8-6.4 8.2-3.8-1.4-6.4-4.4-6.4-8.2V5L10 2.4Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="m7.4 9.8 1.8 1.8 3.4-3.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <input
            className={joinClassNames(styles.input, styles.inputWithIcon, styles.passwordInput)}
            id={CONFIRM_PASSWORD_ID}
            type={showConfirmPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="再次输入密码"
            required
            value={values.confirmPassword}
            onChange={handleConfirmPasswordChange}
            aria-invalid={confirmPasswordError === undefined ? undefined : 'true'}
            aria-describedby={confirmPasswordError === undefined ? undefined : CONFIRM_PASSWORD_ERROR_ID}
          />
          <button
            type="button"
            className={styles.eyeToggle}
            aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
            title={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
            aria-pressed={showConfirmPassword}
            aria-controls={CONFIRM_PASSWORD_ID}
            onClick={handleToggleConfirmPassword}
          >
            {showConfirmPassword ? '隐藏' : '显示'}
          </button>
        </div>
        {confirmPasswordError === undefined ? null : (
          <p className={styles.fieldError} id={CONFIRM_PASSWORD_ERROR_ID}>
            {confirmPasswordError}
          </p>
        )}
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={DISPLAY_NAME_ID}>
            称呼 <span className={styles.optional}>（可选）</span>
          </label>
          <input
            className={styles.input}
            id={DISPLAY_NAME_ID}
            type="text"
            autoComplete="nickname"
            placeholder="留空时使用用户名"
            value={values.displayName}
            onChange={handleDisplayNameChange}
            aria-invalid={displayNameError === undefined ? undefined : 'true'}
            aria-describedby={displayNameError === undefined ? undefined : DISPLAY_NAME_ERROR_ID}
          />
          {displayNameError === undefined ? (
            <p className={styles.hint}>最多 {MAX_DISPLAY_NAME_LENGTH} 个字符</p>
          ) : (
            <p className={styles.fieldError} id={DISPLAY_NAME_ERROR_ID}>
              {displayNameError}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={IDENTITY_ID}>
            身份标签 <span className={styles.optional}>（可选）</span>
          </label>
          {/* 身份标签只做展示，不进入请求体（D-01） */}
          <select
            className={styles.select}
            id={IDENTITY_ID}
            value={values.identityTag}
            onChange={handleIdentityChange}
            aria-describedby={IDENTITY_HINT_ID}
          >
            <option value="">不填写</option>
            {IDENTITY_TAGS.map((tag) => (
              <option key={tag.value} value={tag.value}>
                {tag.label}
              </option>
            ))}
          </select>
          <p className={styles.hint} id={IDENTITY_HINT_ID}>
            仅用于后续推荐
          </p>
        </div>
      </div>

      <button type="submit" className={styles.submit} disabled={submitting}>
        <span>{submitting ? '正在创建账号…' : '创建账号'}</span>
        {submitting ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <svg className={styles.submitArrow} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
            <path
              d="M4 10h11m0 0-4.2-4.2M15 10l-4.2 4.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </form>
  );
}

export default RegisterForm;
