export type UserRole = 'traveler' | 'sender' | 'admin' | 'marketing' | 'support';
export type AccountStatus = 'pending' | 'active' | 'suspended';
export type VerificationStatus = 'unverified' | 'pending' | 'approved' | 'rejected';
export type DocumentType = 'passport' | 'national_id' | 'driver_license';
export type VerificationRequestStatus = 'pending' | 'approved' | 'rejected';
export type AuditAction =
  | 'verification_approved'
  | 'verification_rejected'
  | 'user_deleted'
  | 'message_deleted'
  | 'email_change_requested'
  | 'email_change_approved'
  | 'email_change_rejected'
  | 'role_change_requested'
  | 'role_change_approved'
  | 'role_change_rejected'
  | 'account_deletion_requested'
  | 'account_deletion_approved'
  | 'account_deletion_rejected'
  | 'notification_preferences_updated'
  | 'currency_preference_changed'
  | 'password_changed'
  | 'shipment_received'
  | 'delivery_verified'
  | 'qr_revoked'
  | 'qr_regenerated'
  | 'fee_change'
  | 'refund_approved'
  | 'refund_processed'
  | 'payment_adjusted'
  | 'refund_rejected'
  | 'refund_completed'
  | 'payment_completed'
  | 'payment_held'
  | 'payment_released'
  | 'receipt_uploaded'
  | 'receipt_approved'
  | 'receipt_rejected'
  | 'payout_submitted'
  | 'payout_approved'
  | 'payout_rejected'
  | 'payout_completed'
  | 'payment_receiving_number_changed'
  | 'marketer_assigned'
  | 'marketing_settings_changed'
  | 'commission_created'
  | 'commission_approved'
  | 'commission_paid'
  | 'commission_reversed'
  | 'listing_cancelled'
  | 'maintenance_enabled'
  | 'maintenance_disabled'
  | 'feedback_status_changed'
  | 'feedback_visibility_changed'
  | 'feedback_archived';

export type UserRequestType = 'email_change' | 'role_change' | 'account_deletion';
export type UserRequestStatus = 'pending' | 'approved' | 'rejected';
export type TripStatus = 'draft' | 'published' | 'in_progress' | 'completed' | 'cancelled';
export type ListingStatus = 'draft' | 'published' | 'matched' | 'completed' | 'cancelled';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  account_status: AccountStatus;
  verification_status: VerificationStatus;
  identity_verified: boolean;
  preferred_currency: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileUpdateInput {
  full_name?: string | null;
  email?: string;
}

export interface VerificationRequest {
  id: string;
  user_id: string;
  full_name: string;
  date_of_birth: string;
  document_type: DocumentType;
  document_number: string;
  issuing_country: string;
  document_file_path: string;
  status: VerificationRequestStatus;
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  admin_id: string | null;
  target_user_id: string | null;
  action: AuditAction;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  created_at: string;
}

export interface AuditLogWithProfiles extends AuditLog {
  admin_profile?: { full_name: string | null } | null;
  target_profile?: { full_name: string | null } | null;
}

export interface VerificationRequestWithUser extends VerificationRequest {
  profiles?: {
    email: string;
    full_name: string | null;
  };
}

export interface Trip {
  id: string;
  traveler_id: string;
  origin: string;
  destination: string;
  departure_date: string;
  arrival_date: string;
  available_weight_kg: number;
  price_per_kg: number;
  notes: string | null;
  status: TripStatus;
  created_at: string;
  updated_at: string;
}

export interface TripInput {
  origin: string;
  destination: string;
  departure_date: string;
  arrival_date: string;
  available_weight_kg: number;
  price_per_kg: number;
  notes?: string | null;
  status?: TripStatus;
}

export interface TripWithTraveler extends Trip {
  profiles?: {
    full_name: string | null;
  };
}

export interface SenderListing {
  id: string;
  sender_id: string;
  product_name: string;
  description: string;
  quantity: number;
  weight_kg: number;
  origin: string;
  destination: string;
  preferred_date: string | null;
  budget: number | null;
  notes: string | null;
  status: ListingStatus;
  created_at: string;
  updated_at: string;
}

export interface ListingInput {
  product_name: string;
  description: string;
  quantity: number;
  weight_kg: number;
  origin: string;
  destination: string;
  preferred_date?: string | null;
  budget?: number | null;
  notes?: string | null;
  status?: ListingStatus;
}

export interface ListingWithSender extends SenderListing {
  profiles?: {
    full_name: string | null;
  };
}

export type CollaborationStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'completed';

export interface Collaboration {
  id: string;
  trip_id: string;
  sender_listing_id: string;
  traveler_id: string;
  sender_id: string;
  status: CollaborationStatus;
  message: string | null;
  proposed_weight_kg: number;
  proposed_price: number;
  agreed_weight_kg: number | null;
  agreed_price: number | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
}

export interface CollaborationInput {
  trip_id: string;
  sender_listing_id: string;
  traveler_id: string;
  sender_id: string;
  message?: string | null;
  proposed_weight_kg: number;
  proposed_price: number;
}

export interface CollaborationWithDetails extends Collaboration {
  trips?: {
    origin: string;
    destination: string;
    departure_date: string;
    arrival_date: string;
    available_weight_kg: number;
    price_per_kg: number;
    profiles?: { full_name: string | null };
  };
  sender_listings?: {
    product_name: string;
    weight_kg: number;
    origin: string;
    destination: string;
    preferred_date: string | null;
    profiles?: { full_name: string | null };
  };
}

export type NotificationType =
  | 'collaboration_request'
  | 'collaboration_accepted'
  | 'collaboration_rejected'
  | 'new_message'
  | 'order_created'
  | 'order_confirmed'
  | 'shipment_in_transit'
  | 'shipment_delivered'
  | 'receipt_confirmed'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_awaiting_payment'
  | 'payment_pending'
  | 'payment_paid'
  | 'payment_failed'
  | 'payment_held'
  | 'payment_released'
  | 'payment_refund_requested'
  | 'payment_refunded'
  | 'payment_cancelled'
  | 'payment_completed'
  | 'payment_refund_rejected'
  | 'payment_receipt_uploaded'
  | 'payment_receipt_approved'
  | 'payment_receipt_rejected'
  | 'payout_requested'
  | 'payout_approved'
  | 'payout_completed'
  | 'payout_rejected'
  | 'commission_created'
  | 'commission_approved'
  | 'commission_paid'
  | 'commission_reversed'
  | 'feedback_status_changed'
  | 'admin_role_request'
  | 'admin_verification_request'
  | 'admin_account_deletion_request'
  | 'request_approved'
  | 'request_rejected';

export type OrderStatus = 'pending' | 'awaiting_payment' | 'confirmed' | 'in_transit' | 'delivered' | 'received' | 'completed' | 'cancelled';

export type TrackingEventType =
  | 'order_created'
  | 'order_confirmed'
  | 'shipment_picked_up'
  | 'shipment_in_transit'
  | 'shipment_delivered'
  | 'receipt_confirmed'
  | 'order_completed'
  | 'order_cancelled';

export interface Order {
  id: string;
  collaboration_id: string;
  trip_id: string;
  sender_listing_id: string;
  traveler_id: string;
  sender_id: string;
  order_number: string;
  status: OrderStatus;
  agreed_weight_kg: number;
  agreed_price: number;
  platform_fee: number;
  total_amount: number;
  currency: string;
  pickup_location: string | null;
  delivery_location: string | null;
  expected_delivery_date: string | null;
  sender_confirmed_at: string | null;
  traveler_confirmed_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentTrackingEvent {
  id: string;
  order_id: string;
  status: TrackingEventType;
  title: string;
  description: string | null;
  location: string | null;
  created_by: string;
  created_at: string;
}

export interface OrderWithDetails extends Order {
  trips?: {
    origin: string;
    destination: string;
    departure_date: string;
    arrival_date: string;
    profiles?: { full_name: string | null };
  };
  sender_listings?: {
    product_name: string;
    weight_kg: number;
    origin: string;
    destination: string;
    profiles?: { full_name: string | null };
  };
  traveler_profile?: { full_name: string | null };
  sender_profile?: { full_name: string | null };
  latest_tracking_event?: ShipmentTrackingEvent | null;
  shipment_receipt_photo?: ShipmentReceiptPhoto | null;
  delivery_qr_token?: DeliveryQrToken | null;
}

export interface ShipmentReceiptPhoto {
  id: string;
  order_id: string;
  traveler_id: string;
  storage_path: string;
  created_at: string;
}

export interface DeliveryQrToken {
  id: string;
  order_id: string;
  token: string;
  is_used: boolean;
  used_at: string | null;
  used_by: string | null;
  is_revoked: boolean;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
}

export type ConversationContextType = 'collaboration' | 'support';
export type SupportStatus = 'open' | 'closed';

export interface Conversation {
  id: string;
  collaboration_id: string | null;
  traveler_id: string;
  sender_id: string | null;
  context_type: ConversationContextType;
  support_status: SupportStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_text: string;
  created_at: string;
  updated_at: string;
  read_at: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  related_collaboration_id: string | null;
  related_conversation_id: string | null;
  related_message_id: string | null;
  related_order_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  created_at: string;
  requester_id: string | null;
}

// ============================================================
// Phase 7: Payments & Financial Types
// ============================================================

export type PaymentStatus = 'pending' | 'processing' | 'held' | 'paid' | 'released' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded';
export type PaymentMethodType = 'card' | 'bank_transfer' | 'wallet' | 'cash_on_delivery' | 'manual' | 'instapay' | 'mobile_wallet';
export type RefundStatus = 'requested' | 'approved' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type LedgerEntryType = 'payment' | 'platform_fee' | 'platform_held' | 'platform_release' | 'refund' | 'adjustment' | 'payout' | 'marketing_commission';
export type LedgerDirection = 'credit' | 'debit';

export interface PlatformFeeSetting {
  id: string;
  fee_type: string;
  percentage: number;
  fixed_amount: number;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  order_id: string;
  payer_id: string;
  payee_id: string;
  amount: number;
  platform_fee: number;
  net_amount: number;
  currency: string;
  payment_method: PaymentMethodType;
  provider: string | null;
  provider_payment_id: string | null;
  provider_session_id: string | null;
  provider_event_id: string | null;
  provider_reference: string | null;
  provider_status: string | null;
  status: PaymentStatus;
  failure_reason: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentWithDetails extends Payment {
  orders?: {
    order_number: string;
    status: OrderStatus;
    total_amount: number;
    currency: string;
  };
  payer_profile?: { full_name: string | null };
  payee_profile?: { full_name: string | null };
}

export interface FinancialLedgerEntry {
  id: string;
  payment_id: string | null;
  order_id: string | null;
  user_id: string;
  entry_type: LedgerEntryType;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  description: string | null;
  created_at: string;
}

export interface WalletAccount {
  id: string;
  user_id: string;
  currency: string;
  available_balance: number;
  pending_balance: number;
  created_at: string;
  updated_at: string;
}

export interface Refund {
  id: string;
  payment_id: string;
  order_id: string;
  amount: number;
  reason: string | null;
  status: RefundStatus;
  provider_refund_id: string | null;
  requested_by: string;
  approved_by: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface RefundWithDetails extends Refund {
  payments?: {
    amount: number;
    currency: string;
    status: PaymentStatus;
  };
  orders?: {
    order_number: string;
  };
  requester_profile?: { full_name: string | null };
  approver_profile?: { full_name: string | null };
}

export interface ConversationWithDetails extends Conversation {
  collaborations?: {
    trips?: {
      origin: string;
      destination: string;
    };
    sender_listings?: {
      product_name: string;
    };
  };
  last_message?: {
    message_text: string;
    created_at: string;
    sender_id: string;
  };
  other_participant?: {
    full_name: string | null;
  };
}

export interface MessageWithSender extends Message {
  profiles?: {
    full_name: string | null;
  };
}

export interface UserRequest {
  id: string;
  user_id: string;
  request_type: UserRequestType;
  status: UserRequestStatus;
  requested_email: string | null;
  requested_role: UserRole | null;
  previous_role: UserRole | null;
  reason: string | null;
  admin_reason: string | null;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface UserRequestWithUser extends UserRequest {
  profiles?: {
    email: string;
    full_name: string | null;
    role: UserRole;
    verification_status: VerificationStatus;
  };
}

// ============================================================
// Phase 9: Manual Payment Receipts & Payouts
// ============================================================

export type ReceiptStatus = 'pending_verification' | 'approved' | 'rejected';
export type PayoutMethodType = 'vodafone_cash' | 'orange_cash' | 'etisalat_cash' | 'we_pay' | 'instapay' | 'bank_transfer';
export type PayoutStatus = 'pending' | 'approved' | 'processing' | 'completed' | 'rejected';

export interface PaymentReceipt {
  id: string;
  payment_id: string;
  order_id: string;
  uploader_id: string;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  status: ReceiptStatus;
  rejection_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payout {
  id: string;
  payment_id: string;
  order_id: string;
  traveler_id: string;
  payout_method: PayoutMethodType;
  payout_identifier: string;
  payout_details: Record<string, unknown> | null;
  gross_amount: number;
  platform_fee: number;
  net_amount: number;
  currency: string;
  status: PayoutStatus;
  approved_by: string | null;
  approved_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  rejection_reason: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayoutWithDetails extends Payout {
  orders?: {
    order_number: string;
    status: OrderStatus;
  };
  traveler_profile?: { full_name: string | null };
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  new_messages: boolean;
  collaboration_requests: boolean;
  collaboration_updates: boolean;
  orders: boolean;
  order_status_changes: boolean;
  shipment_updates: boolean;
  payments: boolean;
  system_notifications: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Marketing System Types
// ============================================================

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'reversed' | 'cancelled';
export type ReferralStatus = 'attributed' | 'registered' | 'converted' | 'expired';
export type CommissionBaseType = 'platform_fee' | 'order_total';

export interface MarketingSettings {
  id: string;
  commission_rate: number;
  commission_base: CommissionBaseType;
  attribution_enabled: boolean;
  attribution_window_days: number;
  referral_code: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface MarketingReferral {
  id: string;
  marketer_id: string;
  referral_code: string;
  referred_user_id: string | null;
  status: ReferralStatus;
  first_seen_at: string;
  registered_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingCommission {
  id: string;
  marketer_id: string;
  referred_user_id: string;
  referral_id: string | null;
  order_id: string;
  payment_id: string | null;
  gross_order_amount: number;
  platform_fee_amount: number;
  commission_base_value: number;
  commission_rate: number;
  commission_amount: number;
  commission_base_type: CommissionBaseType;
  currency: string;
  status: CommissionStatus;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  paid_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  metadata: Record<string, unknown>;
}

export interface MarketingPayout {
  id: string;
  marketer_id: string;
  amount: number;
  currency: string;
  status: string;
  payout_method: string | null;
  payout_reference: string | null;
  commission_ids: string[];
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
}

export interface MarketingSocialLink {
  id: string;
  marketer_id: string;
  platform: string;
  profile_url: string;
  display_name: string | null;
  follower_count: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Feedback System Types ("Your Voice Improves El Wazn")
// ============================================================

export type FeedbackType = 'general_feedback' | 'suggestion' | 'bug_report' | 'security_report';
export type FeedbackStatus = 'new' | 'under_review' | 'in_progress' | 'resolved' | 'closed' | 'rejected' | 'archived';
export type FeedbackUserType = 'traveler' | 'sender';
export type FeedbackCategory =
  | 'new_feature'
  | 'improve_existing_feature'
  | 'design'
  | 'traveler_experience'
  | 'sender_experience'
  | 'communication'
  | 'safety_trust'
  | 'identity_verification'
  | 'tracking'
  | 'payments'
  | 'notifications'
  | 'other'
  | 'registration'
  | 'login'
  | 'account'
  | 'create_listing'
  | 'search'
  | 'orders'
  | 'messages'
  | 'file_upload'
  | 'technical_other'
  | 'suspicious_account'
  | 'suspicious_listing'
  | 'inappropriate_behavior'
  | 'off_platform_contact'
  | 'privacy_issue'
  | 'security_other';

export interface Feedback {
  id: string;
  user_id: string;
  user_type: FeedbackUserType;
  type: FeedbackType;
  category: FeedbackCategory;
  title: string;
  message: string;
  rating: number | null;
  status: FeedbackStatus;
  is_public: boolean;
  is_sensitive: boolean;
  source: string | null;
  page_url: string | null;
  device_type: string | null;
  operating_system: string | null;
  browser: string | null;
  context_type: string | null;
  context_id: string | null;
  expected_behavior: string | null;
  proposed_solution: string | null;
  archived_at: string | null;
  archived_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackVote {
  id: string;
  feedback_id: string;
  user_id: string;
  created_at: string;
}

export interface FeedbackAttachment {
  id: string;
  feedback_id: string;
  storage_path: string;
  file_type: string | null;
  created_at: string;
}

export interface FeedbackStatusHistory {
  id: string;
  feedback_id: string;
  old_status: FeedbackStatus | null;
  new_status: FeedbackStatus;
  changed_by: string | null;
  note: string | null;
  created_at: string;
}

export interface FeedbackInternalNote {
  id: string;
  feedback_id: string;
  admin_id: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface FeedbackWithVotes extends Feedback {
  vote_count?: number;
  has_voted?: boolean;
}
