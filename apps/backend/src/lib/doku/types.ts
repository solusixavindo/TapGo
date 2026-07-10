export type DokuEnvironment = "sandbox" | "production";

export type DokuConfig = {
  clientId: string;
  secretKey: string;
  apiKey?: string;
  publicKey?: string;
  merchantPublicKey?: string;
  environment: DokuEnvironment;
  integrationMode: "checkout" | "snap_direct";
  baseUrl: string;
  webhookSecret?: string;
  webhookUrl?: string;
  enabled: boolean;
};

export type DokuCheckoutLineItem = {
  id: string;
  name: string;
  quantity: number;
  price: number;
};

export type DokuCheckoutRequest = {
  order: {
    amount: number;
    invoice_number: string;
    currency: "IDR";
    line_items: DokuCheckoutLineItem[];
    callback_url?: string;
    callback_url_cancel?: string;
    auto_redirect?: boolean;
  };
  payment: {
    payment_due_date: number;
  };
  customer: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
};

export type DokuCheckoutResponse = {
  response?: {
    order?: {
      invoice_number?: string;
    };
    payment?: {
      url?: string;
      token_id?: string;
      expired_date?: string;
      payment_method_types?: string[];
    };
  };
  order?: {
    invoice_number?: string;
  };
  payment?: {
    url?: string;
    token_id?: string;
    expired_date?: string;
  };
  paymentUrl?: string;
  payment_url?: string;
  checkout_url?: string;
  redirect_url?: string;
  token?: string;
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
  [key: string]: unknown;
};

export type DokuNotificationPayload = {
  order?: {
    invoice_number?: string;
    amount?: string | number;
  };
  transaction?: {
    status?: string;
    date?: string;
    original_request_id?: string;
  };
  payment?: {
    type?: string;
  };
  virtual_account_info?: {
    virtual_account_number?: string;
  };
  service?: {
    id?: string;
  };
  acquirer?: {
    id?: string;
  };
  channel?: {
    id?: string;
  };
  reference_id?: string;
  invoice_number?: string;
  status?: string;
  transaction_id?: string;
  [key: string]: unknown;
};

export type DokuCreatePaymentResult = {
  paymentUrl: string;
  referenceId: string;
  expiredAt?: string;
  virtualAccount?: string;
  qrisUrl?: string;
  paymentCode?: string;
  gatewayResponse: DokuCheckoutResponse;
};
