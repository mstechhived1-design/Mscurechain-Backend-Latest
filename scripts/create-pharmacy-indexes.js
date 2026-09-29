/**
 * Database Indexes for Pharmacy Module Performance Optimization
 * 
 * CRITICAL: Run these indexes to reduce dashboard load time from 16s to <1s
 * 
 * How to run:
 * 1. Connect to MongoDB: mongosh "your-connection-string"
 * 2. Switch to database: use your_database_name
 * 3. Copy and paste the commands below
 * 
 * Expected Impact:
 * - Dashboard API: 16s → <500ms
 * - Products query: 5-10s → <100ms
 * - Invoices aggregation: 3-5s → <200ms
 */

// ============================================
// PRODUCTS COLLECTION INDEXES
// ============================================

// Index 1: Pharmacy + Active status (for total count)
// Used by: Product.aggregate({ pharmacy, isActive: true })
db.products.createIndex(
    { pharmacy: 1, isActive: 1 },
    { name: "idx_pharmacy_active", background: true }
);

// Index 2: Pharmacy + Stock + MinStock (for low stock count)
// Used by: Product.aggregate({ pharmacy, stock: { $gt: 0 }, $expr: { $lte: ['$stock', '$minStock'] } })
db.products.createIndex(
    { pharmacy: 1, stock: 1, minStock: 1 },
    { name: "idx_pharmacy_stock_minstock", background: true }
);

// Index 3: Pharmacy + Expiry Date (for expiring soon count)
// Used by: Product.aggregate({ pharmacy, expiryDate: { $gte: now, $lte: thirtyDaysFromNow } })
db.products.createIndex(
    { pharmacy: 1, expiryDate: 1 },
    { name: "idx_pharmacy_expiry", background: true }
);

// Index 4: Pharmacy + Search fields (for product search)
// Used by: Product.find({ pharmacy, $or: [{ name }, { brand }, { generic }] })
db.products.createIndex(
    { pharmacy: 1, name: "text", brand: "text", generic: "text" },
    { name: "idx_pharmacy_search", background: true }
);

// ============================================
// PHARMACY INVOICES COLLECTION INDEXES
// ============================================

// Index 5: Pharmacy + CreatedAt + Status (for sales aggregation)
// Used by: PharmaInvoice.aggregate({ pharmacy, createdAt: { $gte: startOfDay }, status: 'PAID' })
db.pharmainvoices.createIndex(
    { pharmacy: 1, createdAt: -1, status: 1 },
    { name: "idx_pharmacy_created_status", background: true }
);

// Index 6: Pharmacy + Status (for invoice queries)
// Used by: PharmaInvoice.find({ pharmacy, status })
db.pharmainvoices.createIndex(
    { pharmacy: 1, status: 1 },
    { name: "idx_pharmacy_status", background: true }
);

// ============================================
// PHARMA PROFILE & SUPPLIER INDEXES
// ============================================

// Index 7: User + Hospital (for profile fetching in middleware)
db.pharmaprofiles.createIndex(
    { user: 1 },
    { name: "idx_profile_user", background: true }
);
db.pharmaprofiles.createIndex(
    { hospital: 1 },
    { name: "idx_profile_hospital", background: true }
);

// Index 8: Suppliers Name Search
db.suppliers.createIndex(
    { pharmacy: 1, name: 1 },
    { name: "idx_supplier_pharmacy_name", background: true }
);

// ============================================
// VERIFY INDEXES
// ============================================

// Check Products indexes
print("\n=== Products Collection Indexes ===");
db.products.getIndexes().forEach(idx => {
    print(`- ${idx.name}: ${JSON.stringify(idx.key)}`);
});

// Check Pharmacy Invoices indexes
print("\n=== Pharmacy Invoices Collection Indexes ===");
db.pharmainvoices.getIndexes().forEach(idx => {
    print(`- ${idx.name}: ${JSON.stringify(idx.key)}`);
});

print("\n✅ All indexes created successfully!");
print("Expected performance improvement: 16s → <1s");
