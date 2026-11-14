import { useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from 'react';

import styles from './AuthForm.module.css';

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
  /** mock 模式下显示演示账号提示，默认 false */
  mockMode?: boolean;
  /**
   * 账号服务状态提示（`unavailable` 时由页面传入）。
   * 渲染在表单顶部，不改变表单可用性；未传或为空字符串时不渲染。
   */
  serviceHint?: string | null;
}

const IDENTIFIER_ID = 'login-identifier';
const PASSWORD_ID = 'login-password';
const REMEMBER_ID = 'login-remember';
const ERROR_ID = 'login-error';
const HELP_ID = 'login-help';

/**
 * 登录表单（纯受控）：values / status / errorMessage 全部来自页面。
 * 组件内的本地状态只有「是否显示密码」「大写锁定」「帮助展开」三个纯 UI 状态，
 * 不发起任何网络请求。视觉使用准入登记台的编号字段与墨线按钮。
 */
export function LoginForm({
  values,
  status,
  errorMessage,
  onChange,
  onSubmit,
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

  return (
    <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting || undefined} noValidate>
      {hasServiceHint ? (
        <p className={styles.serviceHint} role="status">
          {serviceHint}
        </p>
      ) : null}

      {mockMode ? (
        <p className={styles.mockHint}>演示模式：使用内置演示账号登录，不会连接后端</p>
      ) : null}

      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <label className={styles.label} htmlFor={IDENTIFIER_ID}>
            用户名或邮箱<span className={styles.required} aria-hidden="true">*</span>
          </label>
          <span className={styles.fieldNo} aria-hidden="true">01</span>
        </div>
        <input
          className={styles.input}
          id={IDENTIFIER_ID}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="next"
          spellCheck={false}
          placeholder="lin_x 或 lin@example.com"
          required
          value={values.identifier}
          onChange={handleIdentifierChange}
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={hasError ? ERROR_ID : undefined}
        />
      </div>

      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <label className={styles.label} htmlFor={PASSWORD_ID}>
            密码<span className={styles.required} aria-hidden="true">*</span>
          </label>
          <span className={styles.fieldNo} aria-hidden="true">02</span>
        </div>
        <div className={styles.inputWrap}>
          <input
            className={styles.input}
            id={PASSWORD_ID}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            enterKeyHint="go"
            placeholder="输入密码"
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
            className={styles.eye}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            title={showPassword ? '隐藏密码' : '显示密码'}
            aria-pressed={showPassword}
            aria-controls={PASSWORD_ID}
            onClick={handleTogglePassword}
          >
            {showPassword ? '隐藏' : '显示'}
          </button>
        </div>
        {capsLock ? (
          <p className={styles.caps} role="status">
            大写锁定已开启
          </p>
        ) : null}
      </div>

      <div className={styles.formMeta}>
        <label className={styles.remember}>
          <input
            id={REMEMBER_ID}
            type="checkbox"
            checked={values.remember}
            onChange={handleRememberChange}
          />
          记住我
        </label>
        <button
          type="button"
          className={styles.textLink}
          aria-expanded={helpOpen}
          aria-controls={HELP_ID}
          onClick={handleToggleHelp}
        >
          忘记密码？
        </button>
      </div>

      {helpOpen ? (
        <p className={styles.helpNote} id={HELP_ID} role="status">
          请联系课程管理员重置密码；也可以直接建立一份新档案。
        </p>
      ) : null}

      {hasError ? (
        <p className={styles.summary} role="alert" id={ERROR_ID}>
          {errorMessage}
        </p>
      ) : null}

      <button type="submit" className={styles.submit} disabled={submitting}>
        <span>{submitting ? '正在登录…' : '进入实验室'}</span>
        {submitting ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <span className={styles.submitArrow} aria-hidden="true">↗</span>
        )}
      </button>
    </form>
  );
}

export default LoginForm;
