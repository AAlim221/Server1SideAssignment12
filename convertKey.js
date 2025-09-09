
const fs = require('fs');

// Read the Firebase Admin service key JSON file
const key = fs.readFileSync('./firebase-admin-key.json', 'utf8');  // Ensure the path is correct

// Convert the JSON string to base64
const base64 = Buffer.from(key).toString('base64');

// Print the base64-encoded string
console.log(base64);


