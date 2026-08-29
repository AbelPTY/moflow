import React from "react";
import { BrowserRouter, Routes as RouterRoutes, Route } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
import NotFound from "pages/NotFound";
import GoalsProgress from './pages/goals-progress';
import BudgetTracking from './pages/budget-tracking';
import FinancialOverview from './pages/financial-overview';
import SpendingAnalytics from './pages/spending-analytics';
import CashFlow from './pages/cash-flow';
import Cards from './pages/cards';
import ActionPlan from './pages/action-plan';
import Bills from './pages/bills';
import More from './pages/more';
import BottomNav from './components/navigation/BottomNav';

const Routes = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
      <ScrollToTop />
      <RouterRoutes>
        {/* Define your route here */}
        <Route path="/" element={<Cards />} />
        <Route path="/goals-progress" element={<GoalsProgress />} />
        <Route path="/budget-tracking" element={<BudgetTracking />} />
        <Route path="/cash-flow" element={<CashFlow />} />
        <Route path="/cards" element={<Cards />} />
        <Route path="/action-plan" element={<ActionPlan />} />
        <Route path="/financial-overview" element={<FinancialOverview />} />
        <Route path="/spending-analytics" element={<SpendingAnalytics />} />
        <Route path="/bills" element={<Bills />} />
        <Route path="/more" element={<More />} />
        <Route path="*" element={<NotFound />} />
      </RouterRoutes>
      <BottomNav />
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default Routes;
