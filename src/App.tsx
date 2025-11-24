import { useAuth } from './context/AuthContext';
import { Header } from './components/Layout/Header';
import { LoadingSpinner } from './components/Layout/LoadingSpinner';
import { Login } from './components/Auth/Login';
import { MainApp } from './components/MainApp';

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner fullPage message="Authenticating..." />;
  }

  // Render Header for unauthenticated users, MainApp handles its own Header
  if (!isAuthenticated) {
    return (
      <>
        <Header />
        <div className="container">
          <Login />
        </div>
      </>
    );
  }

  return <MainApp />;
}

export default App;
