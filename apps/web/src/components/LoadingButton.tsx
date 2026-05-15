import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  children: ReactNode;
}

export function LoadingButton({ loading, disabled, children, className, style, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={className ?? 'btn'}
      style={style}
      disabled={disabled || loading}
    >
      {loading && <span className="btn-spinner" />}
      {children}
    </button>
  );
}
