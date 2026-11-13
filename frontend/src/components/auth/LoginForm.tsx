import { useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from 'react';
import { Link } from 'react-router-dom';

import styles from './LoginForm.module.css';

/** 拼接局部类名：过滤掉 `undefined`，避免把字符串 "undefined" 写进 class 属性。 */
function joinClassNames(...names: ReadonlyArray<string | undefined>): string {
  return names.filter((name): name is string => Boolean(name)).join(' ');
}

export interface LoginFormValues {
  /** 用户名或邮箱 */
  identifier: string;
  password: string;
  remember: boolean;
}

export type LoginFormStatus = 'idle' | 'submitting' | 'error';

export interface LoginFormProps {
  values: LoginFormValues;
  status: LoginFormStatus;
  /** status==='error' 时的中文提示；其它状态为 null */
  errorMessage: string | null;
  onChange: (next: LoginFormValues) => void;
  onSubmit: (values: LoginFormValues) => void;
  /** 任一控件焦点进入/离开时回调（页面据此冻结 3D） */
  onFocusChange: (focused: boolean) => void;
  /** mock 模式下显示演示账号提示，默认 false */
  mockMode?: boolean;
  /**
   * 账号服务状态提示（`unavailable` 时由页面传入）。
   * 渲染在标题下方，不改变表单可用性；未传或为空字符串时不渲染。
   */
  serviceHint?: string | null;
}

const IDENTIFIER_ID = 'login-identifier';
const PASSWORD_ID = 'login-password';
const REMEMBER_ID = 'login-remember';
const ERROR_ID = 'login-error';
const HELP_ID = 'login-help';

/**
 * 登录表单（纯受控）：`values` / `status` / `errorMessage` 全部来自父组件，
 * 组件内的本地状态只有「是否显示密码」「大写锁定」「帮助展开」三个纯 UI 状态，
 * 不发起任何网络请求。
 */
export function LoginForm({
  values,
  status,
  errorMessage,
  onChange,
  onSubmit,
  onFocusChange,
  mockMode = false,
  serviceHint = null,
}: LoginFormProps): JSX.Element {
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const submitting = status === 'submitting';
  const hasError = status === 'error' && errorMessage !== null && errorMessage.length > 0;
  const hasServiceHint = serviceHint !== null && serviceHint.trim() !== '';

  const handleIdentifierChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, identifier: event.target.value });
  };

  const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, password: event.target.value });
  };

  const handleRememberChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, remember: event.target.checked });
  };

  /**
   * 切换密码可见性：只改本地 UI 状态，不清空输入、不触发表单提交。
   * `preventDefault()` 保证按钮即使位于表单内也不会诱发任何提交副作用。
   */
  const handleTogglePassword = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setShowPassword((current) => !current);
  };

  const handlePasswordKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    setCapsLock(event.getModifierState('CapsLock'));
  };

  const handleToggleHelp = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setHelpOpen((current) => !current);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit(values);
  };

  /** 焦点进入/离开表单时冒泡到 `<form>`；不在 onBlur 中阻止默认行为。 */
  const handleFocus = (): void => {
    onFocusChange(true);
  };

  const handleBlur = (): void => {
    onFocusChange(false);
  };

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      onFocus={handleFocus}
      onBlur={handleBlur}
      aria-busy={submitting || undefined}
      noValidate
    >
      <header className={styles.header}>
        <p className={styles.kicker}>Welcome back</p>
        <h1 className={styles.title}>欢迎回来</h1>
        <p className={styles.subtitle}>登录后继续你的探索与创作</p>
      </header>

      {/* 账号服务不可用时只提示、不禁用表单：用户仍可尝试登录（R4-AC3） */}
      {hasServiceHint ? (
        <p className={styles.serviceHint} role="status">
          {serviceHint}
        </p>
      ) : null}

      {mockMode ? (
        <p className={styles.mockHint}>演示模式：使用内置演示账号登录，不会连接后端</p>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor={IDENTIFIER_ID}>
          用户名或邮箱
        </label>
        <div className={styles.inputShell}>
          <span className={styles.inputIcon} aria-hidden="true">
            <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
              <circle cx="10" cy="6.6" r="3.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M3.6 17c.7-3 3.2-4.7 6.4-4.7s5.7 1.7 6.4 4.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            className={joinClassNames(styles.input, styles.inputWithIcon)}
            id={IDENTIFIER_ID}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
            autoFocus
            spellCheck={false}
            placeholder="请输入用户名或邮箱"
            required
            value={values.identifier}
            onChange={handleIdentifierChange}
            aria-invalid={hasError ? 'true' : undefined}
            aria-describedby={hasError ? ERROR_ID : undefined}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={PASSWORD_ID}>
          密码
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
            autoComplete="current-password"
            enterKeyHint="go"
            placeholder="请输入密码"
            required
            value={values.password}
            onChange={handlePasswordChange}
            onKeyDown={handlePasswordKey}
            onKeyUp={handlePasswordKey}
            onBlur={() => setCapsLock(false)}
            aria-invalid={hasError ? 'true' : undefined}
            aria-describedby={hasError ? ERROR_ID : undefined}
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
            {showPassword ? (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                <path
                  d="M2.4 10S5.2 4.9 10 4.9 17.6 10 17.6 10 14.8 15.1 10 15.1 2.4 10 2.4 10Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="m4 16 12-12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                <path
                  d="M2.4 10S5.2 4.9 10 4.9 17.6 10 17.6 10 14.8 15.1 10 15.1 2.4 10 2.4 10Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            )}
          </button>
        </div>
        {capsLock ? (
          <p className={styles.capsHint} role="status">
            大写锁定已开启
          </p>
        ) : null}
      </div>

      <div className={styles.metaRow}>
        <span className={styles.checkboxRow}>
          <input
            className={styles.checkbox}
            id={REMEMBER_ID}
            type="checkbox"
            checked={values.remember}
            onChange={handleRememberChange}
          />
          <label className={styles.checkboxLabel} htmlFor={REMEMBER_ID}>
            记住我
          </label>
        </span>
        <button
          type="button"
          className={styles.helpLink}
          aria-expanded={helpOpen}
          aria-controls={HELP_ID}
          onClick={handleToggleHelp}
        >
          忘记密码？
        </button>
      </div>

      {helpOpen ? (
        <p className={styles.helpNote} id={HELP_ID} role="status">
          请联系课程管理员重置密码；也可以直接创建一个新账号。
        </p>
      ) : null}

      {hasError ? (
        <p className={styles.error} role="alert" id={ERROR_ID}>
          <svg
            className={styles.errorIcon}
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M8 1.8 15 14H1L8 1.8Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M8 6.2v3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="11.9" r="0.9" fill="currentColor" />
          </svg>
          {errorMessage}
        </p>
      ) : null}

      <button type="submit" className={styles.submit} disabled={submitting}>
        <span>{submitting ? '正在登录…' : '登录'}</span>
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

      <div className={styles.altRow}>
        <span className={styles.altText}>还没有账号？</span>
        <Link className={styles.altLink} to="/register">
          立即注册
        </Link>
      </div>

      <Link className={styles.guestLink} to="/examples">
        以访客身份浏览交互示例
        <span aria-hidden="true">→</span>
      </Link>
    </form>
  );
}

export default LoginForm;