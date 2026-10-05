import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { LanguageProvider, useLanguage } from "@/hooks/useLanguage";
import { ThemeProvider } from "@/hooks/useTheme";
import { RoleProvider } from "@/hooks/useRole";
import { ImpersonationProvider } from "@/hooks/useImpersonation";
import { WorkspaceProvider } from "@/hooks/useWorkspace";
import { TenantProvider } from "@/contexts/TenantContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PermissionGuard } from "@/components/PermissionGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import { queryClient } from "@/lib/queryClient";

// Eager: routes hit on first paint of an authenticated session.
import Index from "./pages/Index";
import ProductionWorkflowPage from "./pages/ProductionWorkflowPage";

// Lazy: every other page is code-split so the initial bundle shrinks
// dramatically. Navigation feels instant because Vite preloads on hover
// and the Suspense fallback below is a lightweight skeleton.
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ServiceOrdersPage = lazy(() => import("./pages/ServiceOrdersPage"));
const PaymentOrdersPage = lazy(() => import("./pages/PaymentOrdersPage"));
const FinancialPage = lazy(() => import("./pages/FinancialPage"));
const ModulePages = () => import("./pages/ModulePages");
const ProfitDistribution = lazy(() => ModulePages().then((m) => ({ default: m.ProfitDistribution })));
const Accounting = lazy(() => ModulePages().then((m) => ({ default: m.Accounting })));
const Documents = lazy(() => ModulePages().then((m) => ({ default: m.Documents })));
const UsersPage = lazy(() => ModulePages().then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() => ModulePages().then((m) => ({ default: m.SettingsPage })));
const FleetPage = lazy(() => import("./pages/FleetPage"));
const BillingPage = lazy(() => import("./pages/BillingPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const AutomationsPage = lazy(() => import("./pages/AutomationsPage"));
const AIPage = lazy(() => import("./pages/AIPage"));
const RecoveryPage = lazy(() => import("./pages/RecoveryPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage"));
const PlatformOwnerPage = lazy(() => import("./pages/PlatformOwnerPage"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const ProductionPage = lazy(() => import("./pages/ProductionPage"));
const MarketplacePage = lazy(() => import("./pages/MarketplacePage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const WorkspaceOnboardingPage = lazy(() => import("./pages/onboarding/WorkspaceOnboardingPage"));
const TermsPage = lazy(() => import("./pages/legal/LegalPages").then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import("./pages/legal/LegalPages").then((m) => ({ default: m.PrivacyPage })));
const GdprPage = lazy(() => import("./pages/legal/LegalPages").then((m) => ({ default: m.GdprPage })));
const CookiesPage = lazy(() => import("./pages/legal/LegalPages").then((m) => ({ default: m.CookiesPage })));
const DataProcessingPage = lazy(() => import("./pages/legal/LegalPages").then((m) => ({ default: m.DataProcessingPage })));
const ClientsScreenBilling = lazy(() => import("./components/billing/ClientsScreen").then((m) => ({ default: m.default })));
const PeoplePage = lazy(() => import("./pages/PeoplePage"));
const LocationsPage = lazy(() => import("./pages/LocationsPage"));
const CountryDocumentRequirementsPage = lazy(() => import("./pages/CountryDocumentRequirementsPage"));

/** Subtle, layout-stable fallback used while a route chunk is loading. */
function RouteFallback() {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-center p-12 text-xs text-muted-foreground/60">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      <span className="ml-2">{t("common.loading", "A carregar…")}</span>
    </div>
  );
}

function RouteContentBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { t } = useLanguage();

  return (
    <ErrorBoundary
      resetKey={`${location.pathname}${location.search}`}
      fallback={(
        <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-lg font-semibold text-foreground">
            {t("error.pageTitle", "Esta página encontrou um erro")}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            {t("error.pageBody", "O menu e a navegação continuam disponíveis. Pode mudar de página ou tentar novamente.")}
          </p>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

const App = () => {
  return (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
        <LanguageProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/landing" element={<LandingPage />} />
                  <Route path="/onboarding/workspace" element={<WorkspaceOnboardingPage />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/legal/terms" element={<TermsPage />} />
                  <Route path="/legal/privacy" element={<PrivacyPage />} />
                  <Route path="/legal/gdpr" element={<GdprPage />} />
                  <Route path="/legal/cookies" element={<CookiesPage />} />
                  <Route path="/legal/data-processing" element={<DataProcessingPage />} />
                  <Route path="/change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />
                  <Route
                    path="/*"
                    element={
                      <ProtectedRoute>
                        <AuthenticatedShell />
                      </ProtectedRoute>
                    }
                  />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </TooltipProvider>
        </LanguageProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
  );
};

/**
 * AuthenticatedShell — keyed on auth user id so the entire impersonation /
 * workspace / role / tenant tree (and AppLayout) unmounts and fully remounts
 * when the session user changes. Prevents "ghost" state from a previous user
 * surviving a user switch.
 */
function AuthenticatedShell() {
  const { user } = useAuth();
  return (
    <ImpersonationProvider key={user?.id ?? "anon"}>
      <WorkspaceProvider>
        <RoleProvider>
          <TenantProvider>
            <AppLayout>
              <RouteContentBoundary>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<PermissionGuard permission="dashboard.view"><Index /></PermissionGuard>} />
                    <Route path="/dashboard" element={<Navigate to="/" replace />} />
                    <Route path="/service-orders" element={<PermissionGuard permission="service_orders.view"><ServiceOrdersPage /></PermissionGuard>} />
                    <Route path="/production" element={<PermissionGuard permission="service_orders.view"><ProductionPage /></PermissionGuard>} />
                    <Route path="/payment-orders" element={<PermissionGuard permission="payment_orders.view"><PaymentOrdersPage /></PermissionGuard>} />
                    <Route path="/production-workflow" element={<PermissionGuard permission="production_workflow.view"><ProductionWorkflowPage /></PermissionGuard>} />
                    <Route path="/financial" element={<PermissionGuard permission="financial.view"><FinancialPage /></PermissionGuard>} />
                    <Route path="/profit" element={<PermissionGuard permission="profit.view"><ProfitDistribution /></PermissionGuard>} />
                    <Route path="/accounting" element={<Navigate to="/financial?tab=accounting" replace />} />
                    <Route path="/fleet" element={<PermissionGuard permission="fleet.view"><FleetPage /></PermissionGuard>} />
                    <Route path="/billing/*" element={<PermissionGuard permission="accounting.view"><BillingPage /></PermissionGuard>} />
                    <Route path="/clients" element={<PermissionGuard permission="accounting.view"><ClientsScreenBilling /></PermissionGuard>} />
                    <Route path="/people" element={<PermissionGuard permission="people.view"><PeoplePage /></PermissionGuard>} />
                    <Route path="/locations" element={<PermissionGuard permission="locations.view"><LocationsPage /></PermissionGuard>} />
                    <Route path="/country-document-requirements" element={<PermissionGuard permission="country_document_requirements.view"><CountryDocumentRequirementsPage /></PermissionGuard>} />
                    <Route path="/documents" element={<PermissionGuard permission="documents.view"><Documents /></PermissionGuard>} />
                    <Route path="/users" element={<PermissionGuard permission="users.view"><UsersPage /></PermissionGuard>} />
                    <Route path="/marketplace" element={<MarketplacePage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/audit" element={<AuditPage />} />
                    <Route path="/automations" element={<PermissionGuard permission="settings.edit"><AutomationsPage /></PermissionGuard>} />
                    <Route path="/automation" element={<Navigate to="/automations" replace />} />
                    <Route path="/ai" element={<PermissionGuard permission="dashboard.view"><AIPage /></PermissionGuard>} />
                    <Route path="/recovery" element={<RecoveryPage />} />
                    <Route path="/subscription" element={<SubscriptionPage />} />
                    <Route path="/subscriptions" element={<Navigate to="/subscription" replace />} />
                    <Route path="/checkout" element={<CheckoutPage />} />
                    <Route path="/platform" element={<PlatformOwnerPage />} />
                    <Route path="/platform-owner" element={<PlatformOwnerPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </RouteContentBoundary>
            </AppLayout>
          </TenantProvider>
        </RoleProvider>
      </WorkspaceProvider>
    </ImpersonationProvider>
  );
}

export default App;
