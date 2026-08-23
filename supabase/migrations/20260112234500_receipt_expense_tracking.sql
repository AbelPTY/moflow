-- Receipt Upload and Expense Tracking Module
-- Enables image-based expense entry with AI-powered OCR
-- Supports detailed categorization and merchant tracking for reporting

-- ============================================
-- 1. CUSTOM TYPES
-- ============================================

CREATE TYPE public.transaction_type AS ENUM ('expense', 'income');
CREATE TYPE public.receipt_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE public.expense_type AS ENUM ('business', 'personal', 'mixed');

-- ============================================
-- 2. CORE TABLES
-- ============================================

-- Expense Categories with hierarchical structure
CREATE TABLE public.expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    parent_category_id UUID REFERENCES public.expense_categories(id) ON DELETE CASCADE,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Merchant/Supplier profiles for better tracking
CREATE TABLE public.merchant_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    logo_url TEXT,
    supplier_type TEXT,
    tax_id TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    notes TEXT,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table (expenses and income)
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    merchant_id UUID REFERENCES public.merchant_profiles(id) ON DELETE SET NULL,
    category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    subcategory_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    transaction_type public.transaction_type DEFAULT 'expense'::public.transaction_type,
    expense_type public.expense_type DEFAULT 'personal'::public.expense_type,
    amount DECIMAL(12, 2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    tax_amount DECIMAL(12, 2),
    tip_amount DECIMAL(12, 2),
    description TEXT,
    transaction_date TIMESTAMPTZ NOT NULL,
    account TEXT,
    payment_method TEXT,
    reference_number TEXT,
    tags TEXT[],
    notes TEXT,
    is_recurring BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Receipts table for image storage and metadata
CREATE TABLE public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    status public.receipt_status DEFAULT 'pending'::public.receipt_status,
    upload_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    processed_date TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- OCR extracted data from receipts
CREATE TABLE public.receipt_ocr_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID REFERENCES public.receipts(id) ON DELETE CASCADE,
    extracted_text TEXT,
    merchant_name TEXT,
    merchant_address TEXT,
    merchant_phone TEXT,
    transaction_date TIMESTAMPTZ,
    total_amount DECIMAL(12, 2),
    subtotal_amount DECIMAL(12, 2),
    tax_amount DECIMAL(12, 2),
    tip_amount DECIMAL(12, 2),
    currency TEXT,
    payment_method TEXT,
    card_last_four TEXT,
    receipt_number TEXT,
    suggested_category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    confidence_score DECIMAL(3, 2),
    line_items JSONB,
    raw_response JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. STORAGE BUCKET SETUP
-- ============================================

-- Create private bucket for receipt images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'receipts',
    'receipts',
    false,  -- Private bucket
    10485760, -- 10MB limit
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
);

-- ============================================
-- 4. INDEXES
-- ============================================

CREATE INDEX idx_expense_categories_parent ON public.expense_categories(parent_category_id);
CREATE INDEX idx_merchant_profiles_category ON public.merchant_profiles(category_id);
CREATE INDEX idx_merchant_profiles_name ON public.merchant_profiles(name);
CREATE INDEX idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX idx_transactions_merchant_id ON public.transactions(merchant_id);
CREATE INDEX idx_transactions_category_id ON public.transactions(category_id);
CREATE INDEX idx_transactions_date ON public.transactions(transaction_date DESC);
CREATE INDEX idx_transactions_type ON public.transactions(transaction_type);
CREATE INDEX idx_receipts_user_id ON public.receipts(user_id);
CREATE INDEX idx_receipts_transaction_id ON public.receipts(transaction_id);
CREATE INDEX idx_receipts_status ON public.receipts(status);
CREATE INDEX idx_receipt_ocr_data_receipt_id ON public.receipt_ocr_data(receipt_id);

-- ============================================
-- 5. FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- ============================================
-- 6. ENABLE RLS
-- ============================================

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_ocr_data ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 7. RLS POLICIES
-- ============================================

-- Expense Categories: Public read, authenticated can suggest
CREATE POLICY "public_read_expense_categories"
ON public.expense_categories
FOR SELECT
TO public
USING (true);

CREATE POLICY "authenticated_insert_expense_categories"
ON public.expense_categories
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Merchant Profiles: Public read, authenticated can create
CREATE POLICY "public_read_merchant_profiles"
ON public.merchant_profiles
FOR SELECT
TO public
USING (true);

CREATE POLICY "authenticated_manage_merchant_profiles"
ON public.merchant_profiles
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Transactions: Users manage their own
CREATE POLICY "users_manage_own_transactions"
ON public.transactions
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Receipts: Users manage their own
CREATE POLICY "users_manage_own_receipts"
ON public.receipts
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Receipt OCR Data: Users access their own receipt data
CREATE POLICY "users_access_own_receipt_ocr_data"
ON public.receipt_ocr_data
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.receipts r
        WHERE r.id = receipt_ocr_data.receipt_id
        AND r.user_id = auth.uid()
    )
);

CREATE POLICY "users_insert_receipt_ocr_data"
ON public.receipt_ocr_data
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.receipts r
        WHERE r.id = receipt_ocr_data.receipt_id
        AND r.user_id = auth.uid()
    )
);

-- Storage RLS: Users access only their receipt files
CREATE POLICY "users_manage_own_receipt_files"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'receipts' AND owner = auth.uid())
WITH CHECK (bucket_id = 'receipts' AND owner = auth.uid());

-- ============================================
-- 8. TRIGGERS
-- ============================================

CREATE TRIGGER update_expense_categories_updated_at
    BEFORE UPDATE ON public.expense_categories
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_merchant_profiles_updated_at
    BEFORE UPDATE ON public.merchant_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 9. MOCK DATA
-- ============================================

DO $$
DECLARE
    -- Category IDs
    cat_groceries UUID := gen_random_uuid();
    cat_transportation UUID := gen_random_uuid();
    cat_entertainment UUID := gen_random_uuid();
    cat_utilities UUID := gen_random_uuid();
    cat_healthcare UUID := gen_random_uuid();
    cat_dining UUID := gen_random_uuid();
    cat_shopping UUID := gen_random_uuid();
    cat_subscriptions UUID := gen_random_uuid();

    -- Subcategory IDs
    subcat_fresh_produce UUID := gen_random_uuid();
    subcat_dairy UUID := gen_random_uuid();
    subcat_fuel UUID := gen_random_uuid();
    subcat_restaurants UUID := gen_random_uuid();

    -- Merchant IDs
    merchant_whole_foods UUID := gen_random_uuid();
    merchant_starbucks UUID := gen_random_uuid();
    merchant_shell UUID := gen_random_uuid();
    merchant_amazon UUID := gen_random_uuid();

    -- User ID (get from existing user_profiles if exists)
    demo_user_id UUID;
BEGIN
    -- Get existing user or use placeholder
    SELECT id INTO demo_user_id FROM public.user_profiles LIMIT 1;

    -- If no user exists, create a demo user ID (for preview purposes)
    IF demo_user_id IS NULL THEN
        demo_user_id := gen_random_uuid();
    END IF;

    -- Insert main categories
    INSERT INTO public.expense_categories (id, name, icon, color, parent_category_id, description) VALUES
        (cat_groceries, 'Groceries & Food', 'ShoppingCart', '#38A169', NULL, 'Food and grocery purchases'),
        (cat_transportation, 'Transportation', 'Car', '#3282B8', NULL, 'Vehicle and travel expenses'),
        (cat_entertainment, 'Entertainment', 'Film', '#D69E2E', NULL, 'Movies, games, and leisure'),
        (cat_utilities, 'Utilities', 'Zap', '#E53E3E', NULL, 'Electric, water, gas bills'),
        (cat_healthcare, 'Healthcare', 'Heart', '#FF6B35', NULL, 'Medical and health expenses'),
        (cat_dining, 'Dining Out', 'Coffee', '#0F4C75', NULL, 'Restaurants and cafes'),
        (cat_shopping, 'Shopping', 'ShoppingBag', '#805AD5', NULL, 'Retail and online shopping'),
        (cat_subscriptions, 'Subscriptions', 'Tv', '#6B46C1', NULL, 'Recurring subscription services');

    -- Insert subcategories
    INSERT INTO public.expense_categories (id, name, icon, color, parent_category_id, description) VALUES
        (subcat_fresh_produce, 'Fresh Produce', 'Apple', '#38A169', cat_groceries, 'Fruits and vegetables'),
        (subcat_dairy, 'Dairy & Eggs', 'Milk', '#38A169', cat_groceries, 'Milk, cheese, eggs'),
        (subcat_fuel, 'Fuel & Gas', 'Fuel', '#3282B8', cat_transportation, 'Vehicle fuel'),
        (subcat_restaurants, 'Restaurants', 'Utensils', '#0F4C75', cat_dining, 'Full-service dining');

    -- Insert merchant profiles
    INSERT INTO public.merchant_profiles (id, name, category_id, logo_url, supplier_type, is_verified) VALUES
        (merchant_whole_foods, 'Whole Foods Market', cat_groceries, 'https://img.rocket.new/generatedImages/rocket_gen_img_190549593-1768212803668.png', 'Grocery Store', true),
        (merchant_starbucks, 'Starbucks Coffee', cat_dining, 'https://images.unsplash.com/photo-1650826124996-85f417b1492b', 'Coffee Shop', true),
        (merchant_shell, 'Shell Gas Station', cat_transportation, 'https://images.unsplash.com/photo-1596400639437-9f15af1af507', 'Gas Station', true),
        (merchant_amazon, 'Amazon.com', cat_shopping, 'https://images.unsplash.com/photo-1625737183256-be5f7290629b', 'Online Retailer', true);

    -- Insert sample transactions
    INSERT INTO public.transactions (
        user_id, merchant_id, category_id, subcategory_id, transaction_type,
        amount, tax_amount, description, transaction_date, account, payment_method
    ) VALUES
        (demo_user_id, merchant_whole_foods, cat_groceries, subcat_fresh_produce, 'expense'::public.transaction_type, 87.45, 6.12, 'Weekly grocery shopping', NOW() - INTERVAL '2 days', 'Chase Checking', 'Credit Card'),
        (demo_user_id, merchant_starbucks, cat_dining, subcat_restaurants, 'expense'::public.transaction_type, 12.50, 0.88, 'Morning coffee and breakfast', NOW() - INTERVAL '1 day', 'Chase Checking', 'Debit Card'),
        (demo_user_id, merchant_shell, cat_transportation, subcat_fuel, 'expense'::public.transaction_type, 45.00, 3.15, 'Gas fill-up', NOW() - INTERVAL '3 days', 'Chase Checking', 'Credit Card'),
        (demo_user_id, merchant_amazon, cat_shopping, NULL, 'expense'::public.transaction_type, 156.78, 12.54, 'Office supplies and books', NOW() - INTERVAL '5 days', 'Chase Checking', 'Credit Card');

    RAISE NOTICE 'Receipt expense tracking schema created successfully with sample data';
END $$;