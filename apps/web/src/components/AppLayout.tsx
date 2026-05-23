import { NavLink, Outlet } from 'react-router-dom';

/** Pill-style nav button classes for router links. */
function navBtnClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'app-nav-btn app-nav-btn--active' : 'app-nav-btn';
}

export function AppLayout() {
  return (
    <>
      <header className='app-navbar'>
        <div className='app-navbar-inner'>
          <NavLink className='app-navbar-brand' to='/' end>
            Job Bot
          </NavLink>
          <nav className='app-navbar-links' aria-label='Main'>
            <NavLink className={navBtnClass} to='/postings'>
              Postings
            </NavLink>
            <NavLink className={navBtnClass} to='/sources'>
              Sources
            </NavLink>
            <NavLink className={navBtnClass} to='/workers'>
              Workers
            </NavLink>
            <NavLink className={navBtnClass} to='/evaluators'>
              Evaluators
            </NavLink>
            <NavLink className={navBtnClass} to='/settings'>
              Settings
            </NavLink>
          </nav>
        </div>
      </header>
      <main className='page'>
        <Outlet />
      </main>
    </>
  );
}
