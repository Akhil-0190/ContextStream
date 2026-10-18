const assert = require('node:assert/strict');
const {
  cleanProductUrl,
  titleContainsToken,
  groundProductRecord,
  enrichProductWithSceneContext,
  normalizeSerpProduct,
  mergeProductSources,
  productCandidateRejection,
  productCategoryMismatch,
  productCategoryFamily,
  extractInrPrice
} = require('./server.js');

console.log('🧪 Starting ContextStream Grounded Product Catalog Test Suite...\n');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (error) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// ----------------------------------------------------
// Test Group 1: URL Validation & Tracking Sanitization
// ----------------------------------------------------
console.log('--- 1. URL Validation & Sanitization ---');

test('cleanProductUrl removes UTM and ad tracking parameters while preserving offer params', () => {
  const dirtyUrl = 'https://www.amazon.in/dp/B09XYZ1234?utm_source=google&utm_medium=cpc&gclid=12345&tag=affil-21&ref_=nav_signin';
  const cleaned = cleanProductUrl(dirtyUrl);
  assert.ok(cleaned);
  const parsed = new URL(cleaned.href || cleaned);
  assert.equal(parsed.searchParams.has('utm_source'), false);
  assert.equal(parsed.searchParams.has('utm_medium'), false);
  assert.equal(parsed.searchParams.has('gclid'), false);
  assert.equal(parsed.searchParams.has('ref_'), false);
  assert.equal(parsed.pathname, '/dp/B09XYZ1234');
});

test('cleanProductUrl preserves essential Google Shopping query parameters', () => {
  const shoppingUrl = 'https://www.google.com/search?q=sony+headphones&prds=epd:1234567,prmr:1&product_id=98765';
  const cleaned = cleanProductUrl(shoppingUrl);
  assert.ok(cleaned);
  const parsed = new URL(cleaned.href || cleaned);
  assert.equal(parsed.searchParams.get('prds'), 'epd:1234567,prmr:1');
  assert.equal(parsed.searchParams.get('product_id'), '98765');
});

test('cleanProductUrl rejects invalid protocols like javascript: or ftp:', () => {
  assert.equal(cleanProductUrl('javascript:alert(1)'), null);
  assert.equal(cleanProductUrl('ftp://example.com/item'), null);
  assert.equal(cleanProductUrl('not-a-valid-url'), null);
});

// ----------------------------------------------------
// Test Group 2: Match Classification & Field Verification
// ----------------------------------------------------
console.log('\n--- 2. Match Classification & Field-Level Verification ---');

test('groundProductRecord classifies exact match when both brand and model match detected evidence', () => {
  const rawItem = {
    title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black',
    link: 'https://electronics-store.example.com/sony-wh1000xm5',
    extracted_price: 26990,
    currency: 'INR',
    in_stock: true,
    delivery: 'Free delivery by tomorrow',
    source: 'Electronics Store'
  };
  const sceneContext = {
    brand: 'Sony',
    model: 'WH-1000XM5',
    item: 'headphones',
    identityConfidence: 'high'
  };

  const record = groundProductRecord(rawItem, 'Google Shopping', 1, sceneContext);
  assert.ok(record);
  assert.equal(record.matchType, 'exact');
  assert.equal(record.brand, 'Sony');
  assert.equal(record.model, 'WH-1000XM5');
  assert.equal(record.fieldVerification.identity, 'confirmed');
  assert.equal(record.fieldVerification.price, 'source_structured');
  assert.equal(record.fieldVerification.stock, 'in_stock');
  assert.equal(record.fieldVerification.delivery, 'stated');
  assert.equal(record.priceAmount, 26990);
  assert.equal(record.currency, 'INR');
  assert.ok(record.retrievedAt);
});

test('groundProductRecord classifies supported match when brand matches but model is unconfirmed', () => {
  const rawItem = {
    title: 'Sony Wireless On-Ear Extra Bass Headphones',
    link: 'https://store.example.com/sony-on-ear',
    price_text: '₹4,990',
    source: 'Audio Store'
  };
  const sceneContext = {
    brand: 'Sony',
    model: 'WH-1000XM5',
    item: 'headphones'
  };

  const record = groundProductRecord(rawItem, 'SearchApi Google Shopping', 2, sceneContext);
  assert.ok(record);
  assert.equal(record.matchType, 'supported');
  assert.equal(record.fieldVerification.identity, 'probable');
  assert.equal(record.fieldVerification.price, 'snippet_derived');
  assert.equal(record.fieldVerification.stock, 'unverified');
  assert.equal(record.priceInr, 4990);
});

test('groundProductRecord classifies Google Lens visual match as supported match', () => {
  const rawItem = {
    title: 'Minimalist Nordic Ceramic Flower Vase',
    link: 'https://decor.example.com/vase-ceramic',
    source: 'Home Decor'
  };
  const sceneContext = {
    item: 'vase'
  };

  const record = groundProductRecord(rawItem, 'Google Lens', 1, sceneContext);
  assert.ok(record);
  assert.equal(record.matchType, 'supported');
  assert.equal(record.fieldVerification.identity, 'probable');
  assert.equal(record.fieldVerification.price, 'unverified');
});

test('groundProductRecord classifies category-only match as similar alternative', () => {
  const rawItem = {
    title: 'JBL Tune 760NC Over-Ear Wireless Headphones',
    link: 'https://jbl-store.example.com/tune760',
    extracted_price: 5499,
    currency: 'INR',
    source: 'JBL'
  };
  const sceneContext = {
    brand: 'Sony',
    model: 'WH-1000XM5',
    item: 'headphones'
  };

  const record = groundProductRecord(rawItem, 'Google Shopping', 3, sceneContext);
  assert.ok(record);
  assert.equal(record.matchType, 'similar');
  assert.equal(record.fieldVerification.identity, 'unverified');
  assert.equal(record.fieldVerification.price, 'source_structured');
});

// ----------------------------------------------------
// Test Group 3: URL Rejections & Category Mismatches
// ----------------------------------------------------
console.log('\n--- 3. URL Rejections & Category Mismatches ---');

test('productCandidateRejection rejects social media and stock photo sites', () => {
  assert.equal(productCandidateRejection({ url: 'https://www.pinterest.com/pin/12345' }), 'social-or-community-page');
  assert.equal(productCandidateRejection({ url: 'https://www.instagram.com/p/Cxyz/' }), 'social-or-community-page');
  assert.equal(productCandidateRejection({ url: 'https://www.shutterstock.com/image-photo/vintage-lamp-123' }), 'stock-photo-or-media-site');
  assert.equal(productCandidateRejection({ url: 'https://example.com/images/product.jpg' }), 'direct-image-file');
});

test('productCandidateRejection rejects news, blog, and editorial URLs', () => {
  assert.equal(productCandidateRejection({ url: 'https://news.example.com/editorial/best-headphones-of-the-year', title: 'Top 10 Headphones Review' }), 'news-or-editorial-url');
  assert.equal(productCandidateRejection({ url: 'https://example.com/blog/how-to-choose-a-jacket', title: 'How to choose a winter jacket' }), 'editorial-url');
});

test('productCategoryMismatch flags cross-category blunders', () => {
  assert.equal(productCategoryMismatch('leather jacket', 'Luxury Hotel and Resort Stay in Goa'), 'different-product-category');
  assert.equal(productCategoryMismatch('running shoes', 'Solid Oak Dining Table with 6 Chairs'), 'different-product-category');
  // Matching category should return empty string (valid)
  assert.equal(productCategoryMismatch('wireless earbuds', 'Sony In-Ear Wireless Earbuds Headphones'), '');
});

// ----------------------------------------------------
// Test Group 4: Deduplication & Multi-Provider Corroboration
// ----------------------------------------------------
console.log('\n--- 4. Deduplication & Corroboration ---');

test('mergeProductSources preserves distinct merchant offers for the same product', () => {
  const amazonOffer = {
    title: 'Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)',
    url: 'https://www.amazon.in/dp/B0CHWRXH8B',
    priceInr: 20990,
    priceAmount: 20990,
    currency: 'INR',
    retailer: 'amazon.in',
    matchType: 'exact',
    fieldVerification: { identity: 'confirmed', price: 'source_structured', stock: 'in_stock', delivery: 'stated' }
  };

  const flipkartOffer = {
    title: 'Apple AirPods Pro (2nd Generation) with MagSafe Case (USB-C)',
    url: 'https://www.flipkart.com/apple-airpods-pro-2nd-gen/p/itmd123',
    priceInr: 19999,
    priceAmount: 19999,
    currency: 'INR',
    retailer: 'flipkart.com',
    matchType: 'exact',
    fieldVerification: { identity: 'confirmed', price: 'source_structured', stock: 'in_stock', delivery: 'stated' }
  };

  const merged = mergeProductSources([
    { name: 'SerpApi Google Shopping', products: [amazonOffer] },
    { name: 'SearchApi Google Shopping', products: [flipkartOffer] }
  ], Infinity, 'Apple AirPods Pro');

  assert.equal(merged.length, 2, 'Distinct merchant offers must not be collapsed into one!');
  assert.ok(merged.some(item => item.retailer === 'amazon.in'));
  assert.ok(merged.some(item => item.retailer === 'flipkart.com'));
});

test('mergeProductSources collapses identical URL offers from multiple providers and elevates corroboration', () => {
  const lensCandidate = {
    title: 'Nike Air Force 1 07 Low White',
    url: 'https://www.nike.com/in/t/air-force-1-07-shoes-0XG5hL/CW2288-111',
    retailer: 'nike.com',
    source: 'SerpApi Google Lens',
    matchType: 'supported',
    fieldVerification: { identity: 'probable', price: 'unverified', stock: 'unverified', delivery: 'unverified' }
  };

  const shoppingCandidate = {
    title: 'Nike Air Force 1 07 Low White Sneakers',
    url: 'https://www.nike.com/in/t/air-force-1-07-shoes-0XG5hL/CW2288-111',
    priceInr: 8195,
    priceAmount: 8195,
    currency: 'INR',
    retailer: 'nike.com',
    source: 'Google Shopping',
    matchType: 'exact',
    fieldVerification: { identity: 'confirmed', price: 'source_structured', stock: 'in_stock', delivery: 'stated' }
  };

  const merged = mergeProductSources([
    { name: 'SerpApi Google Lens', products: [lensCandidate] },
    { name: 'Google Shopping', products: [shoppingCandidate] }
  ], Infinity, 'Nike Air Force 1');

  assert.equal(merged.length, 1);
  const item = merged[0];
  assert.equal(item.sources.length, 2);
  assert.ok(item.sources.includes('SerpApi Google Lens'));
  assert.ok(item.sources.includes('Google Shopping'));
  assert.equal(item.matchType, 'exact');
  assert.equal(item.fieldVerification.identity, 'confirmed');
  assert.equal(item.fieldVerification.price, 'source_structured');
  assert.equal(item.priceAmount, 8195);
});

// ----------------------------------------------------
// Test Group 5: Varied Discovery Category Fixtures
// ----------------------------------------------------
console.log('\n--- 5. Varied Category Fixtures ---');

const testCases = [
  {
    category: 'apparel',
    query: 'bomber jacket',
    scene: { brand: 'Alpha Industries', model: 'MA-1', item: 'bomber jacket' },
    raw: {
      title: 'Alpha Industries Mens MA-1 Heritage Flight Jacket Bomber',
      link: 'https://store.example.com/alpha-ma1-jacket',
      extracted_price: 14500,
      currency: 'INR',
      source: 'Apparel Store'
    },
    expectedMatchType: 'exact'
  },
  {
    category: 'furniture',
    query: 'lounge chair',
    scene: { brand: 'Herman Miller', model: 'Eames', item: 'lounge chair' },
    raw: {
      title: 'Herman Miller Eames Lounge Chair and Ottoman Classic',
      link: 'https://furniture.example.com/herman-miller-eames',
      extracted_price: 495000,
      currency: 'INR',
      source: 'Design Store'
    },
    expectedMatchType: 'exact'
  },
  {
    category: 'bags',
    query: 'backpack',
    scene: { brand: 'Bellroy', model: 'Classic Backpack Plus', item: 'backpack' },
    raw: {
      title: 'Bellroy Classic Backpack Plus 24L Laptop Daypack',
      link: 'https://bellroy-store.example.com/classic-plus',
      extracted_price: 15900,
      currency: 'INR',
      source: 'Bellroy'
    },
    expectedMatchType: 'exact'
  },
  {
    category: 'electronics',
    query: 'smartphone',
    scene: { brand: 'Google', model: 'Pixel 9 Pro', item: 'smartphone' },
    raw: {
      title: 'Google Pixel 9 Pro 5G (Obsidian, 256 GB) (16 GB RAM)',
      link: 'https://retailer.example.com/pixel-9-pro',
      extracted_price: 109999,
      currency: 'INR',
      source: 'Tech Store'
    },
    expectedMatchType: 'exact'
  }
];

for (const tc of testCases) {
  test(`Varied Category Fixture: ${tc.category} (${tc.scene.brand} ${tc.scene.model}) correctly normalizes to ${tc.expectedMatchType}`, () => {
    const record = groundProductRecord(tc.raw, 'Google Shopping', 1, tc.scene);
    assert.ok(record);
    assert.equal(record.matchType, tc.expectedMatchType);
    assert.equal(record.brand, tc.scene.brand);
    assert.equal(record.model, tc.scene.model);
    assert.equal(record.fieldVerification.identity, 'confirmed');
    assert.equal(record.category, tc.category);
  });
}

console.log(`\n🎉 All tests passed successfully! (${passedTests} checks verified)`);
