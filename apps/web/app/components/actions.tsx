'use client';

import { LoaderCircle } from 'lucide-react';
import Link, { type LinkProps } from 'next/link';
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-dd-forest bg-dd-forest text-white shadow-dd-soft hover:-translate-y-px hover:bg-dd-forest-dark',
  secondary:
    'border-[1.5px] border-dd-forest/25 border-dd-border-interactive bg-white text-dd-forest shadow-xs hover:border-dd-forest hover:bg-dd-surface-muted',
  ghost:
    'border-transparent bg-transparent text-dd-forest hover:bg-dd-surface-muted hover:text-dd-forest-dark',
  danger:
    'border-dd-danger bg-dd-danger text-white shadow-dd-soft hover:-translate-y-px hover:brightness-95',
  link: 'min-h-0 border-transparent bg-transparent p-0 text-dd-forest underline-offset-4 hover:underline',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-10 min-h-[44px] px-3.5 text-xs',
  md: 'min-h-11 min-h-[44px] px-5 text-sm',
  lg: 'min-h-12 min-h-[48px] px-6 text-sm sm:text-base',
};

export function actionClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}) {
  return [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-dd-md border font-semibold no-underline transition duration-150',
    'focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#09371f]',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none',
    variantClasses[variant],
    sizeClasses[size],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    loadingLabel,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={actionClasses({ variant, size, fullWidth, className })}
    >
      {loading ? (
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        leadingIcon
      )}
      <span className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap">
        {loading && loadingLabel ? loadingLabel : children}
      </span>
      {!loading && trailingIcon}
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  children,
  leadingIcon,
  trailingIcon,
  ...props
}: LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    leadingIcon?: ReactNode;
    trailingIcon?: ReactNode;
  }) {
  return (
    <Link
      {...props}
      className={actionClasses({ variant, size, fullWidth, className: className ?? '' })}
    >
      {leadingIcon}
      <span className="whitespace-nowrap">{children}</span>
      {trailingIcon}
    </Link>
  );
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'children' | 'aria-label'> & { label: string; children: ReactNode }
>(function IconButton({ label, className, children, ...props }, ref) {
  return (
    <Button
      {...props}
      ref={ref}
      aria-label={label}
      className={`h-11 min-h-11 w-11 min-w-11 shrink-0 p-0 ${className ?? ''}`}
    >
      <span aria-hidden="true">{children}</span>
    </Button>
  );
});

export function ActionGroup({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`flex flex-wrap items-center gap-3 ${className}`}>{children}</div>;
}

export function StickyActionBar({
  children,
  description,
  className = '',
}: {
  children: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sticky bottom-[calc(var(--dd-nav-bawah,0px)+1rem+env(safe-area-inset-bottom))] z-20 grid gap-3 rounded-dd-xl border border-dd-line bg-white/95 p-4 shadow-dd-float backdrop-blur sm:static sm:flex sm:items-center sm:justify-between ${className}`}
    >
      {description && <div className="text-xs leading-5 text-dd-muted">{description}</div>}
      <div className="flex flex-col gap-3 sm:ml-auto sm:flex-row">{children}</div>
    </div>
  );
}
