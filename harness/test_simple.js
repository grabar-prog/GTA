// Simple verification that project files exist and can be parsed
const fs = require('fs');
const path = require('path');

console.log('Testing Meridian City project structure...');

try {
  // Check main HTML file exists
  const htmlExists = fs.existsSync('D:\\projects\\bionic\\gta.html');
  console.log('✓ gta.html exists:', htmlExists);
  
  // Check test harness exists
  const checkFileExists = fs.existsSync('D:\\projects\\bionic\\tools\\check-city.js');
  console.log('✓ check-city.js exists:', checkFileExists);
  
  // Check package.json exists
  const packageExists = fs.existsSync('D:\\projects\\bionic\\package.json');
  console.log('✓ package.json exists:', packageExists);
  
  if (htmlExists && checkFileExists) {
    console.log('\nProject structure looks good for headless testing.');
    
    // Try to load and parse the main file
    const htmlContent = fs.readFileSync('D:\\projects\\bionic\\gta.html', 'utf8');
    console.log('✓ gta.html read successfully (size:', htmlContent.length, 'chars)');
    
    // Try to load test harness
    const checkContent = fs.readFileSync('D:\\projects\\bionic\\tools\\check-city.js', 'utf8');
    console.log('✓ check-city.js read successfully (size:', checkContent.length, 'chars)');
    
    console.log('\nProject is ready for headless testing.');
  } else {
    console.log('\nMissing key project files - cannot proceed with test execution.');
  }
  
} catch (error) {
  console.error('Error during verification:', error.message);
}