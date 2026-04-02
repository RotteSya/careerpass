import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import CalendarCallback from "./pages/CalendarCallback";
import AgentChat from "./pages/AgentChat";
import JobTracker from "./pages/JobTracker";
import ESGenerator from "./pages/ESGenerator";
import InterviewSimulator from "./pages/InterviewSimulator";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/register" component={Register} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/dashboard/calendar/callback" component={CalendarCallback} />
      <Route path="/dashboard/chat" component={AgentChat} />
      <Route path="/dashboard/jobs" component={JobTracker} />
      <Route path="/dashboard/es" component={ESGenerator} />
      <Route path="/dashboard/interview" component={InterviewSimulator} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
