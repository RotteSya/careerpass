import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Register from "./pages/Register";
import SignUp from "./pages/SignUp";
import Login from "./pages/Login";
import EmailVerified from "./pages/EmailVerified";
import Dashboard from "./pages/Dashboard";
import CalendarCallback from "./pages/CalendarCallback";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Waitlist from "./pages/Waitlist";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";

const ALWAYS_ACCESSIBLE = ["/waitlist", "/privacy", "/terms"];

function WaitlistGate({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isLoading) return;
    if (user && user.role === "admin") return;
    if (ALWAYS_ACCESSIBLE.some((p) => location.startsWith(p))) return;
    navigate("/waitlist", { replace: true });
  }, [isLoading, user, location, navigate]);

  if (isLoading) return null;
  if (user && user.role === "admin") return <>{children}</>;
  if (ALWAYS_ACCESSIBLE.some((p) => location.startsWith(p))) return <>{children}</>;
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/waitlist" component={Waitlist} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route
        path="/:rest*"
        component={() => (
          <WaitlistGate>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/signup" component={SignUp} />
              <Route path="/login" component={Login} />
              <Route path="/email-verified" component={EmailVerified} />
              <Route path="/register" component={Register} />
              <Route path="/dashboard/calendar/callback" component={CalendarCallback} />
              <Route path="/dashboard/:section" component={Dashboard} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/404" component={NotFound} />
              <Route component={NotFound} />
            </Switch>
          </WaitlistGate>
        )}
      />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
