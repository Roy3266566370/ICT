import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  IDENTITY_TAGS,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  VERIFICATION_CODE_LENGTH,
  type IdentityTag,
  type RegisterFieldErrors,
  type RegisterFormValues,
} from './registerFields';
import type { RegisterStatus } from './useRegisterSubmit';
import type { SendCodeStatus } from './useSendRegisterCode';

import styles from './AuthForm.module.css';

export interface RegisterFormProps {
  values: RegisterFormValues;
  status: RegisterStatus;
  errorMessage: string | null;
  fieldErrors: RegisterFieldErrors;
  onChange: (next: RegisterFormValues) => void;
  onSubmit: (values: RegisterFormValues) => void;
  /** 发送验证码按钮的状态与倒计时 */
  codeStatus: SendCodeStatus;
  codeMessage: string | null;
  codeCooldown: number;
  /** 冷却是否作用于当前邮箱 */
  codeCooldownActive: boolean;
  onSendCode: (email: string) => void;
  mockMode?: boolean;
  duplicateEmail?: boolean;
  duplicateUsername?: boolean;
  serviceHint?: string | null;
}

const USERNAME_ID = 'register-username';
const EMAIL_ID = 'register-email';
const CODE_ID = 'register-code';
const PASSWORD_ID = 'register-password';
const CONFIRM_PASSWORD_ID = 'register-confirm-password';
const DISPLAY_NAME_ID = 'register-display-name';
const IDENTITY_ID = 'register-identity';
const ERROR_ID = 'register-error';
const USERNAME_ERROR_ID = 'register-username-error';
const EMAIL_ERROR_ID = 'register-email-error';
const CODE_ERROR_ID = 'register-code-error';
const CODE_NOTICE_ID = 'register-code-notice';
const PASSWORD_ERROR_ID = 'register-password-error';
const CONFIRM_PASSWORD_ERROR_ID = 'register-confirm-password-error';
const DISPLAY_NAME_ERROR_ID = 'register-display-name-error';
const STRENGTH_ID = 'register-password-strength';

function readIdentityTag(raw: string): IdentityTag | '' {
  const matched = IDENTITY_TAGS.find((tag) => tag.value === raw);
  return matched === undefined ? '' : matched.value;
}

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

/**
 * 注册表单（纯受控）：视觉使用准入登记台的编号字段。
 * 校验仍由 useRegisterSubmit 调用 registerFields.ts 完成；
 * 组件只负责展示、密码可见性、强度条与大写锁定提示。
 */
export function RegisterForm({
  values,
  status,
  errorMessage,
  fieldErrors,
  onChange,
  onSubmit,
  codeStatus,
  codeMessage,
  codeCooldown,
  codeCooldownActive,
  onSendCode,
  mockMode = false,
  duplicateEmail = false,
  duplicateUsername = false,
  serviceHint = null,
}: RegisterFormProps): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [capsField, setCapsField] = useState<'password' | 'confirm' | null>(null);

  useEffect(() => {
    if (Object.keys(fieldErrors).length > 0) {
      formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
    }
  }, [fieldErrors]);

  const submitting = status === 'submitting';
  const hasError = status === 'error' && errorMessage !== null && errorMessage.length > 0;
  const usernameError = fieldErrors.username;
  const emailError = fieldErrors.email;
  const verificationCodeError = fieldErrors.verificationCode;
  const passwordError = fieldErrors.password;
  const confirmPasswordError = fieldErrors.confirmPassword;
  const displayNameError = fieldErrors.displayName;
  const strength = passwordStrength(values.password);
  const hasServiceHint = serviceHint !== null && serviceHint.trim() !== '';
  const hasCodeMessage = codeMessage !== null && codeMessage.trim() !== '';
  const sendingCode = codeStatus === 'sending';
  /** 发送验证码期间也禁止提交，避免用旧/已作废的验证码抢占请求。 */
  const submitDisabled = submitting || sendingCode;
  const codeButtonDisabled = submitting || sendingCode || codeCooldownActive;
  const codeButtonLabel = sendingCode
    ? '发送中…'
    : codeCooldownActive
      ? `${codeCooldown}s 后重发`
      : '发送验证码';
  const codeDescribedBy =
    [
      verificationCodeError === undefined ? null : CODE_ERROR_ID,
      hasCodeMessage ? CODE_NOTICE_ID : null,
    ]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  const handleUsernameChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, username: event.target.value });
  };
  const handleEmailChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...values, email: event.target.value });
  };
  const handleVerificationCodeChange = (event: ChangeEvent<HTMLInputElement>): void => {
    // 只保留数字并截断到 6 位，避免中文输入法/粘贴带入空白与符号
    const digits = event.target.value.replace(/\D/gu, '').slice(0, VERIFICATION_CODE_LENGTH);
    onChange({ ...values, verificationCode: digits });
  };
  const handleSendCode = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    onSendCode(values.email);
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

  const handleTogglePassword = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setShowPassword((current) => !current);
  };
  const handleToggleConfirmPassword = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setShowConfirmPassword((current) => !current);
  };

  const handlePasswordKey = (field: 'password' | 'confirm') => (event: KeyboardEvent<HTMLInputElement>): void => {
    setCapsField(event.getModifierState('CapsLock') ? field : null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <form ref={formRef} className={styles.form} onSubmit={handleSubmit} aria-busy={submitting || undefined} noValidate>
      {hasServiceHint ? (
        <p className={styles.serviceHint} role="status">
          {serviceHint}
        </p>
      ) : null}
      {mockMode ? (
        <p className={styles.mockHint}>演示模式：使用本地示例注册，不会连接后端</p>
      ) : null}

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <label className={styles.label} htmlFor={USERNAME_ID}>
              用户名<span className={styles.required} aria-hidden="true">*</span>
            </label>
            <span className={styles.fieldNo} aria-hidden="true">01</span>
          </div>
          <input
            className={styles.input}
            id={USERNAME_ID}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="lin_x"
            maxLength={MAX_USERNAME_LENGTH}
            required
            value={values.username}
            onChange={handleUsernameChange}
            aria-invalid={usernameError === undefined ? undefined : 'true'}
            aria-describedby={usernameError === undefined ? undefined : USERNAME_ERROR_ID}
          />
          <p className={styles.hint}>3–20 位，字母开头；可用字母、数字、_、-</p>
          {usernameError === undefined ? null : (
            <p className={styles.error} id={USERNAME_ERROR_ID}>{usernameError}</p>
          )}
          {duplicateUsername && usernameError === undefined ? (
            <p className={styles.error} id={USERNAME_ERROR_ID}>该用户名已被占用，请换一个</p>
          ) : null}
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <label className={styles.label} htmlFor={EMAIL_ID}>
              邮箱<span className={styles.required} aria-hidden="true">*</span>
            </label>
            <span className={styles.fieldNo} aria-hidden="true">02</span>
          </div>
          <input
            className={styles.input}
            id={EMAIL_ID}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="lin@example.com"
            required
            value={values.email}
            onChange={handleEmailChange}
            aria-invalid={emailError === undefined ? undefined : 'true'}
            aria-describedby={emailError === undefined ? undefined : EMAIL_ERROR_ID}
          />
          <p className={styles.hint}>用于登录与通知</p>
          {emailError === undefined ? null : (
            <p className={styles.error} id={EMAIL_ERROR_ID}>{emailError}</p>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <label className={styles.label} htmlFor={CODE_ID}>
            邮箱验证码<span className={styles.required} aria-hidden="true">*</span>
          </label>
          <span className={styles.fieldNo} aria-hidden="true">03</span>
        </div>
        <div className={styles.codeRow}>
          <input
            className={styles.input}
            id={CODE_ID}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6 位数字"
            maxLength={VERIFICATION_CODE_LENGTH}
            required
            value={values.verificationCode}
            onChange={handleVerificationCodeChange}
            aria-invalid={verificationCodeError === undefined ? undefined : 'true'}
            aria-describedby={codeDescribedBy}
          />
          <button
            type="button"
            className={styles.sendCode}
            disabled={codeButtonDisabled}
            onClick={handleSendCode}
          >
            {codeButtonLabel}
          </button>
        </div>
        <p className={styles.hint}>
          {mockMode ? '演示模式：验证码固定为 123456，不会真的发邮件' : '6 位数字，5 分钟内有效'}
        </p>
        {verificationCodeError === undefined ? null : (
          <p className={styles.error} id={CODE_ERROR_ID}>{verificationCodeError}</p>
        )}
        {hasCodeMessage ? (
          <p
            className={codeStatus === 'error' ? styles.error : styles.codeNotice}
            id={CODE_NOTICE_ID}
            role={codeStatus === 'error' ? 'alert' : 'status'}
          >
            {codeMessage}
          </p>
        ) : null}
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <label className={styles.label} htmlFor={PASSWORD_ID}>
              密码<span className={styles.required} aria-hidden="true">*</span>
            </label>
            <span className={styles.fieldNo} aria-hidden="true">04</span>
          </div>
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              id={PASSWORD_ID}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
              required
              value={values.password}
              onChange={handlePasswordChange}
              onKeyDown={handlePasswordKey('password')}
              onKeyUp={handlePasswordKey('password')}
              onBlur={() => setCapsField(null)}
              aria-invalid={passwordError === undefined ? undefined : 'true'}
              aria-describedby={passwordError === undefined ? STRENGTH_ID : `${PASSWORD_ERROR_ID} ${STRENGTH_ID}`}
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
          <div className={styles.strength} id={STRENGTH_ID} data-level={strength} aria-live="polite">
            <span className={styles.strengthBars} aria-hidden="true"><i /><i /><i /><i /></span>
            <span className={styles.strengthLabel}>
              {strength === 0 ? `至少 ${MIN_PASSWORD_LENGTH} 位` : `强度：${STRENGTH_LABELS[strength]}`}
            </span>
          </div>
          {capsField === 'password' ? <p className={styles.caps} role="status">大写锁定已开启</p> : null}
          {passwordError === undefined ? null : (
            <p className={styles.error} id={PASSWORD_ERROR_ID}>{passwordError}</p>
          )}
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <label className={styles.label} htmlFor={CONFIRM_PASSWORD_ID}>
              确认密码<span className={styles.required} aria-hidden="true">*</span>
            </label>
            <span className={styles.fieldNo} aria-hidden="true">05</span>
          </div>
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              id={CONFIRM_PASSWORD_ID}
              type={showConfirmPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="再次输入密码"
              required
              value={values.confirmPassword}
              onChange={handleConfirmPasswordChange}
              onKeyDown={handlePasswordKey('confirm')}
              onKeyUp={handlePasswordKey('confirm')}
              onBlur={() => setCapsField(null)}
              aria-invalid={confirmPasswordError === undefined ? undefined : 'true'}
              aria-describedby={confirmPasswordError === undefined ? undefined : CONFIRM_PASSWORD_ERROR_ID}
            />
            <button
              type="button"
              className={styles.eye}
              aria-label={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
              title={showConfirmPassword ? '隐藏确认密码' : '显示确认密码'}
              aria-pressed={showConfirmPassword}
              aria-controls={CONFIRM_PASSWORD_ID}
              onClick={handleToggleConfirmPassword}
            >
              {showConfirmPassword ? '隐藏' : '显示'}
            </button>
          </div>
          {capsField === 'confirm' ? <p className={styles.caps} role="status">大写锁定已开启</p> : null}
          {confirmPasswordError === undefined ? null : (
            <p className={styles.error} id={CONFIRM_PASSWORD_ERROR_ID}>{confirmPasswordError}</p>
          )}
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <label className={styles.label} htmlFor={DISPLAY_NAME_ID}>
              称呼 <span className={styles.optional}>（可选）</span>
            </label>
            <span className={styles.fieldNo} aria-hidden="true">06</span>
          </div>
          <input
            className={styles.input}
            id={DISPLAY_NAME_ID}
            type="text"
            autoComplete="nickname"
            placeholder="留空时使用用户名"
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            value={values.displayName}
            onChange={handleDisplayNameChange}
            aria-invalid={displayNameError === undefined ? undefined : 'true'}
            aria-describedby={displayNameError === undefined ? undefined : DISPLAY_NAME_ERROR_ID}
          />
          <p className={styles.hint}>留空时使用用户名</p>
          {displayNameError === undefined ? null : (
            <p className={styles.error} id={DISPLAY_NAME_ERROR_ID}>{displayNameError}</p>
          )}
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <label className={styles.label} htmlFor={IDENTITY_ID}>
              身份标签 <span className={styles.optional}>（可选）</span>
            </label>
            <span className={styles.fieldNo} aria-hidden="true">07</span>
          </div>
          <div className={styles.selectWrap}>
            <select
              className={styles.select}
              id={IDENTITY_ID}
              value={values.identityTag}
              onChange={handleIdentityChange}
            >
              <option value="">不填写</option>
              {IDENTITY_TAGS.map((tag) => (
                <option key={tag.value} value={tag.value}>{tag.label}</option>
              ))}
            </select>
          </div>
          <p className={styles.hint}>仅用于后续推荐</p>
        </div>
      </div>

      {hasError ? (
        <div className={styles.summary} role="alert" id={ERROR_ID}>
          <p>{errorMessage}</p>
          {duplicateEmail ? (
            <p className={styles.summaryAction}>
              <Link className={styles.summaryLink} to="/login">去登录</Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <button type="submit" className={styles.submit} disabled={submitDisabled}>
        <span>{submitting ? '正在创建账号…' : '建立档案'}</span>
        {submitting ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : (
          <span className={styles.submitArrow} aria-hidden="true">↗</span>
        )}
      </button>
    </form>
  );
}

export default RegisterForm;
