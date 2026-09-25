import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ThemeProvider } from '@/i18n/ThemeContext';
import { AuthProvider } from '@/auth/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppErrorBoundary } from '@/components/shared/AppErrorBoundary';

import { HomePage } from '@/pages/public/HomePage';
import { LoginPage } from '@/pages/public/LoginPage';
import { RegisterPage } from '@/pages/public/RegisterPage';
import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/public/ResetPasswordPage';
import { DiscoverTripsPage, TripDetailPage } from '@/pages/public/DiscoverTripsPage';
import { DiscoverShipmentsPage, ListingDetailPage } from '@/pages/public/DiscoverShipmentsPage';

import { UserDashboard } from '@/pages/user/UserDashboard';
import { ProfilePage } from '@/pages/user/ProfilePage';
import { VerificationPage } from '@/pages/user/VerificationPage';
import { FeedbackCenterPage } from '@/pages/user/FeedbackCenterPage';
import { FeedbackMyPage } from '@/pages/user/FeedbackMyPage';
import { FeedbackIdeasPage } from '@/pages/user/FeedbackIdeasPage';
import { SettingsPage } from '@/pages/user/SettingsPage';
import { UserTripsPage } from '@/pages/user/UserTripsPage';
import { TripFormPage } from '@/pages/user/TripFormPage';
import { UserShipmentsPage } from '@/pages/user/UserShipmentsPage';
import { ListingFormPage } from '@/pages/user/ListingFormPage';
import { UserCollaborationsPage } from '@/pages/user/UserCollaborationsPage';
import { CollaborationDetailPage } from '@/pages/user/CollaborationDetailPage';
import { UserMessagesPage } from '@/pages/user/UserMessagesPage';
import { ConversationDetailPage } from '@/pages/user/ConversationDetailPage';
import { UserNotificationsPage } from '@/pages/user/UserNotificationsPage';
import { UserOrdersPage } from '@/pages/user/UserOrdersPage';
import { OrderDetailPage } from '@/pages/user/OrderDetailPage';
import { UserPaymentsPage } from '@/pages/user/UserPaymentsPage';
import { PaymentDetailPage } from '@/pages/user/PaymentDetailPage';
import { UserWalletPage } from '@/pages/user/UserWalletPage';

import { DeliveryVerifyPage } from '@/pages/public/DeliveryVerifyPage';

import { AdminOverview } from '@/pages/admin/AdminOverview';
import { AdminUsers } from '@/pages/admin/AdminUsers';
import { AdminVerification } from '@/pages/admin/AdminVerification';
import { AdminTravelers } from '@/pages/admin/AdminTravelers';
import { AdminSenders } from '@/pages/admin/AdminSenders';
import { AdminTrips } from '@/pages/admin/AdminTrips';
import { AdminProducts } from '@/pages/admin/AdminProducts';
import { AdminCollaborations } from '@/pages/admin/AdminCollaborations';
import { AdminMessages } from '@/pages/admin/AdminMessages';
import { AdminNotifications } from '@/pages/admin/AdminNotifications';
import { AdminOrders } from '@/pages/admin/AdminOrders';
import { AdminPayments } from '@/pages/admin/AdminPayments';
import { AdminFees } from '@/pages/admin/AdminFees';
import { AdminRefunds } from '@/pages/admin/AdminRefunds';
import { AdminAuditLogs } from '@/pages/admin/AdminAuditLogs';
import { AdminSettings } from '@/pages/admin/AdminSettings';
import { AdminRequests } from '@/pages/admin/AdminRequests';
import { AdminMarketing } from '@/pages/admin/AdminMarketing';
import { AdminFeedback } from '@/pages/admin/AdminFeedback';
import { AdminFeedbackAnalytics } from '@/pages/admin/AdminFeedbackAnalytics';

import { MarketingDashboard } from '@/pages/marketing/MarketingDashboard';
import { MarketingOrdersPage } from '@/pages/marketing/MarketingOrdersPage';
import { MarketingNotificationsPage } from '@/pages/marketing/MarketingNotificationsPage';
import { MarketingReferralsPage } from '@/pages/marketing/MarketingReferralsPage';
import { MarketingAnalyticsPage } from '@/pages/marketing/MarketingAnalyticsPage';
import { MarketingToolsPage } from '@/pages/marketing/MarketingToolsPage';
import { MarketingCommissionsPage } from '@/pages/marketing/MarketingCommissionsPage';
import { MarketingPayoutsPage } from '@/pages/marketing/MarketingPayoutsPage';
import { MarketingLayout } from '@/pages/marketing/MarketingLayout';

import { SupportDashboard } from '@/pages/support/SupportDashboard';
import { SupportConversationsList } from '@/pages/support/SupportConversationsList';
import { SupportConversationDetail } from '@/pages/support/SupportConversationDetail';
import { SupportSettingsPage } from '@/pages/support/SupportSettingsPage';

import { AccessDeniedPage, NotFoundPage } from '@/pages/ErrorPages';
import { MaintenancePage } from '@/pages/public/MaintenancePage';
import { RecoveryRedirect } from '@/components/auth/RecoveryRedirect';

export default function App() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <AppErrorBoundary>
        <AuthProvider>
        <BrowserRouter>
          <RecoveryRedirect />
          <Routes>
            {/* Public */}
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/trips" element={<DiscoverTripsPage />} />
            <Route path="/trips/:id" element={<TripDetailPage />} />
            <Route path="/shipments" element={<DiscoverShipmentsPage />} />
            <Route path="/shipments/:id" element={<ListingDetailPage />} />
            <Route path="/access-denied" element={<AccessDeniedPage />} />
            <Route path="/maintenance" element={<MaintenancePage />} />
            <Route path="/delivery/verify/:token" element={<DeliveryVerifyPage />} />

            {/* User */}
            <Route path="/dashboard" element={<ProtectedRoute><UserDashboard /></ProtectedRoute>} />
            <Route path="/dashboard/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="/dashboard/trips" element={<ProtectedRoute><UserTripsPage /></ProtectedRoute>} />
            <Route path="/dashboard/trips/new" element={<ProtectedRoute><TripFormPage /></ProtectedRoute>} />
            <Route path="/dashboard/trips/:id/edit" element={<ProtectedRoute><TripFormPage /></ProtectedRoute>} />
            <Route path="/dashboard/shipments" element={<ProtectedRoute><UserShipmentsPage /></ProtectedRoute>} />
            <Route path="/dashboard/shipments/new" element={<ProtectedRoute><ListingFormPage /></ProtectedRoute>} />
            <Route path="/dashboard/shipments/:id/edit" element={<ProtectedRoute><ListingFormPage /></ProtectedRoute>} />
            <Route path="/dashboard/collaborations" element={<ProtectedRoute><UserCollaborationsPage /></ProtectedRoute>} />
            <Route path="/dashboard/collaborations/:id" element={<ProtectedRoute><CollaborationDetailPage /></ProtectedRoute>} />
            <Route path="/dashboard/orders" element={<ProtectedRoute><UserOrdersPage /></ProtectedRoute>} />
            <Route path="/dashboard/orders/:id" element={<ProtectedRoute><OrderDetailPage /></ProtectedRoute>} />
            <Route path="/dashboard/payments" element={<ProtectedRoute><UserPaymentsPage /></ProtectedRoute>} />
            <Route path="/dashboard/payments/:id" element={<ProtectedRoute><PaymentDetailPage /></ProtectedRoute>} />
            <Route path="/dashboard/wallet" element={<ProtectedRoute><UserWalletPage /></ProtectedRoute>} />
            <Route path="/dashboard/messages" element={<ProtectedRoute><UserMessagesPage /></ProtectedRoute>} />
            <Route path="/dashboard/messages/:id" element={<ProtectedRoute><ConversationDetailPage /></ProtectedRoute>} />
            <Route path="/dashboard/notifications" element={<ProtectedRoute><UserNotificationsPage /></ProtectedRoute>} />
            <Route path="/dashboard/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="/dashboard/verification" element={<ProtectedRoute><VerificationPage /></ProtectedRoute>} />
            <Route path="/dashboard/feedback" element={<ProtectedRoute requireRole={['traveler', 'sender']}><FeedbackCenterPage /></ProtectedRoute>} />
            <Route path="/dashboard/feedback/my" element={<ProtectedRoute requireRole={['traveler', 'sender']}><FeedbackMyPage /></ProtectedRoute>} />
            <Route path="/dashboard/feedback/ideas" element={<ProtectedRoute requireRole={['traveler', 'sender']}><FeedbackIdeasPage /></ProtectedRoute>} />

            {/* Marketing */}
            <Route path="/marketing" element={<ProtectedRoute requireRole="marketing"><MarketingDashboard /></ProtectedRoute>} />
            <Route path="/marketing/referrals" element={<ProtectedRoute requireRole="marketing"><MarketingReferralsPage /></ProtectedRoute>} />
            <Route path="/marketing/analytics" element={<ProtectedRoute requireRole="marketing"><MarketingAnalyticsPage /></ProtectedRoute>} />
            <Route path="/marketing/tools" element={<ProtectedRoute requireRole="marketing"><MarketingToolsPage /></ProtectedRoute>} />
            <Route path="/marketing/commissions" element={<ProtectedRoute requireRole="marketing"><MarketingCommissionsPage /></ProtectedRoute>} />
            <Route path="/marketing/payouts" element={<ProtectedRoute requireRole="marketing"><MarketingPayoutsPage /></ProtectedRoute>} />
            <Route path="/marketing/completed-orders" element={<ProtectedRoute requireRole="marketing"><MarketingOrdersPage /></ProtectedRoute>} />
            <Route path="/marketing/profile" element={<ProtectedRoute requireRole="marketing"><ProfilePage Layout={MarketingLayout} /></ProtectedRoute>} />
            <Route path="/marketing/verification" element={<ProtectedRoute requireRole="marketing"><VerificationPage Layout={MarketingLayout} /></ProtectedRoute>} />
            <Route path="/marketing/notifications" element={<ProtectedRoute requireRole="marketing"><MarketingNotificationsPage /></ProtectedRoute>} />
            <Route path="/marketing/settings" element={<ProtectedRoute requireRole="marketing"><MarketingLayout><SettingsPage /></MarketingLayout></ProtectedRoute>} />

            {/* Admin */}
            <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminOverview /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/verification" element={<ProtectedRoute requireAdmin><AdminVerification /></ProtectedRoute>} />
            <Route path="/admin/travelers" element={<ProtectedRoute requireAdmin><AdminTravelers /></ProtectedRoute>} />
            <Route path="/admin/senders" element={<ProtectedRoute requireAdmin><AdminSenders /></ProtectedRoute>} />
            <Route path="/admin/trips" element={<ProtectedRoute requireAdmin><AdminTrips /></ProtectedRoute>} />
            <Route path="/admin/products" element={<ProtectedRoute requireAdmin><AdminProducts /></ProtectedRoute>} />
            <Route path="/admin/shipments" element={<ProtectedRoute requireAdmin><AdminProducts /></ProtectedRoute>} />
            <Route path="/admin/collaborations" element={<ProtectedRoute requireAdmin><AdminCollaborations /></ProtectedRoute>} />
            <Route path="/admin/orders" element={<ProtectedRoute requireAdmin><AdminOrders /></ProtectedRoute>} />
            <Route path="/admin/payments" element={<ProtectedRoute requireAdmin><AdminPayments /></ProtectedRoute>} />
            <Route path="/admin/fees" element={<ProtectedRoute requireAdmin><AdminFees /></ProtectedRoute>} />
            <Route path="/admin/refunds" element={<ProtectedRoute requireAdmin><AdminRefunds /></ProtectedRoute>} />
            <Route path="/admin/messages" element={<ProtectedRoute requireAdmin><AdminMessages /></ProtectedRoute>} />
            <Route path="/admin/notifications" element={<ProtectedRoute requireAdmin><AdminNotifications /></ProtectedRoute>} />
            <Route path="/admin/audit-logs" element={<ProtectedRoute requireAdmin><AdminAuditLogs /></ProtectedRoute>} />
            <Route path="/admin/requests" element={<ProtectedRoute requireAdmin><AdminRequests /></ProtectedRoute>} />
            <Route path="/admin/marketing" element={<ProtectedRoute requireAdmin><AdminMarketing /></ProtectedRoute>} />
            <Route path="/admin/feedback" element={<ProtectedRoute requireAdmin><AdminFeedback /></ProtectedRoute>} />
            <Route path="/admin/feedback/analytics" element={<ProtectedRoute requireAdmin><AdminFeedbackAnalytics /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute requireAdmin><AdminSettings /></ProtectedRoute>} />

            {/* Support */}
            <Route path="/support" element={<ProtectedRoute requireRole="support"><SupportDashboard /></ProtectedRoute>} />
            <Route path="/support/conversations" element={<ProtectedRoute requireRole="support"><SupportConversationsList /></ProtectedRoute>} />
            <Route path="/support/conversations/:id" element={<ProtectedRoute requireRole="support"><SupportConversationDetail /></ProtectedRoute>} />
            <Route path="/support/settings" element={<ProtectedRoute requireRole="support"><SupportSettingsPage /></ProtectedRoute>} />

            {/* Fallback */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
        </AppErrorBoundary>
      </ThemeProvider>
    </LanguageProvider>
  );
}
