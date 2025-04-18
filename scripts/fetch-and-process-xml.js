﻿const fs = require('fs');
const https = require('https');
const { XMLParser } = require('fast-xml-parser');

// XML source URL
const XML_SOURCE_URL = 'https://www.horsimo.cz/google/export/products.xml';

// Function to fetch XML from URL
async function fetchXML(url) {
  console.log(`Fetching XML from ${url}...`);
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch XML: ${res.statusCode} ${res.statusMessage}`));
        return;
      }
      
      // Handle redirects
      if (res.headers.location) {
        console.log(`Following redirect to ${res.headers.location}...`);
        fetchXML(res.headers.location).then(resolve).catch(reject);
        return;
      }
      
      // Collect data
      let data = '';
      res.on('data', (chunk) => { 
        data += chunk; 
        if (data.length % (10 * 1024 * 1024) === 0) { // Log every 10MB
          console.log(`Downloaded ${(data.length / 1024 / 1024).toFixed(2)} MB...`);
        }
      });
      
      res.on('end', () => { 
        console.log(`Download complete. Total size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
        resolve(data); 
      });
    }).on('error', (err) => {
      reject(new Error(`Error fetching XML: ${err.message}`));
    });
  });
}

// Function to clean HTML entities
function cleanHtmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

// Function to add affiliate parameters to URLs
function createAffiliateUrl(originalUrl) {
  if (!originalUrl || originalUrl === '#') return originalUrl;
  
  try {
    // Ensure the original URL is valid before encoding
    new URL(originalUrl); // This will throw if the URL is invalid
    
    // Add affiliate parameter
    const separator = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${separator}aff_id=123`; // Replace with your actual affiliate ID
  } catch (urlError) {
    console.warn(`Invalid URL: ${originalUrl}. Using as is.`);
    return originalUrl;
  }
}

// Main function
async function main() {
  try {
    // Create output directory if it doesn't exist
    if (!fs.existsSync('public')) {
      fs.mkdirSync('public', { recursive: true });
    }
    
    // Fetch XML data
    const xmlData = await fetchXML(XML_SOURCE_URL);
    
    console.log('Parsing XML...');
    const parser = new XMLParser({ ignoreAttributes: true });
    const parsedXml = parser.parse(xmlData);
    
    // Extract items
    const items = parsedXml.rss.channel.item;
    console.log(`Found ${items.length} products`);
    
    // Convert to our product format
    console.log('Converting products...');
    const products = items.map((item, index) => ({
      id: item['g:id'] || `product-${index}`,
      name: cleanHtmlEntities(item.title) || 'N/A',
      description: cleanHtmlEntities(item.description) || 'No description available.',
      imageUrl: item['g:image_link'] || '/placeholder.svg',
      url: createAffiliateUrl(item.link) || '#',
      price: item['g:price'] || 'N/A',
    }));
    
    // Sort by price (most expensive first)
    console.log('Sorting products by price...');
    products.sort((a, b) => {
      const priceA = parseFloat(a.price.replace(/[^0-9.,]/g, '').replace(',', '.'));
      const priceB = parseFloat(b.price.replace(/[^0-9.,]/g, '').replace(',', '.'));
      return isNaN(priceB) ? -1 : isNaN(priceA) ? 1 : priceB - priceA;
    });
    
    // Write full product list
    console.log('Writing products.json...');
    fs.writeFileSync('public/products.json', JSON.stringify(products));
    
    // Write sample (first 100 products)
    console.log('Writing sample-products.json...');
    fs.writeFileSync('public/sample-products.json', JSON.stringify(products.slice(0, 100)));
    
    // Create a search index file (optional, for more efficient searching)
    console.log('Creating search index...');
    const searchIndex = products.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description.substring(0, 200), // Limit description length for index
    }));
    fs.writeFileSync('public/search-index.json', JSON.stringify(searchIndex));
    
    // Create categories (optional)
    console.log('Creating category files...');
    const categories = {};
    products.forEach(product => {
      // Extract category from description or create based on price range
      let category = 'other';
      
      // Price-based categorization (example)
      const price = parseFloat(product.price.replace(/[^0-9.,]/g, '').replace(',', '.'));
      if (!isNaN(price)) {
        if (price < 500) category = 'budget';
        else if (price < 2000) category = 'standard';
        else if (price < 5000) category = 'premium';
        else category = 'luxury';
      }
      
      // Initialize category if it doesn't exist
      if (!categories[category]) {
        categories[category] = [];
      }
      
      // Add product to category
      categories[category].push(product);
    });
    
    // Write category files
    for (const [category, categoryProducts] of Object.entries(categories)) {
      fs.writeFileSync(`public/${category}-products.json`, JSON.stringify(categoryProducts));
    }
    
    // Create an index file with metadata
    const metadata = {
      lastUpdated: new Date().toISOString(),
      totalProducts: products.length,
      categories: Object.keys(categories).map(category => ({
        name: category,
        count: categories[category].length,
        file: `${category}-products.json`
      })),
      files: {
        all: 'products.json',
        sample: 'sample-products.json',
        searchIndex: 'search-index.json'
      }
    };
    fs.writeFileSync('public/index.json', JSON.stringify(metadata));
    
    console.log('Processing complete!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the main function
main();
