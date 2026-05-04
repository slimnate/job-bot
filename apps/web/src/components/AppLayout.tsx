import { NavLink, Outlet } from 'react-router-dom';

export function AppLayout() {
  return (
    <>
      <header className='app-navbar'>
        <div className='app-navbar-inner'>
          <NavLink className='app-navbar-brand' to='/' end>
            Job Bot
          </NavLink>
          <nav className='app-navbar-links' aria-label='Main'>
            <NavLink className={({ isActive }) => (isActive ? 'active' : undefined)} to='/criteria'>
              Criteria
            </NavLink>
            <NavLink className={({ isActive }) => (isActive ? 'active' : undefined)} to='/postings'>
              Postings
            </NavLink>
            <NavLink className={({ isActive }) => (isActive ? 'active' : undefined)} to='/workers'>
              Workers
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
