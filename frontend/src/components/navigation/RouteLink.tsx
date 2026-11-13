import type { ReactElement } from 'react';
import { Link, useLocation, useNavigate, type LinkProps } from 'react-router-dom';
import { routePrefetchHandlers, viewTransitionsAllowed } from './routePrefetch';

/** 带悬停预取与 View Transition 的站内链接；不支持/减少动效时退回普通跳转。 */
export function RouteLink({ to, onClick, ...rest }: LinkProps): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const path = typeof to === 'string' ? to : `${to.pathname ?? ''}${to.search ?? ''}`;
  return (
    <Link
      to={to}
      {...rest}
      {...routePrefetchHandlers(path)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (path === `${location.pathname}${location.search}`) return;
        if (!viewTransitionsAllowed()) return;
        event.preventDefault();
        navigate(to, { viewTransition: true });
      }}
    />
  );
}
