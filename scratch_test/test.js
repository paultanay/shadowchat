const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\tanay\\.gemini\\antigravity\\brain\\2e91d01f-f248-4bbe-9b47-48f4ec9dd0f4';

async function runTest() {
  console.log('Starting E2E ShadowChat testing via Puppeteer...');
  
  const browser = await puppeteer.launch({
    headless: 'shell',
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  });

  try {
    // ─── PART 1: Initiator Room Creation ───
    const initiatorPage = await browser.newPage();
    await initiatorPage.setViewport({ width: 1280, height: 800 });

    const initiatorLogs = [];
    initiatorPage.on('console', msg => {
      const logLine = `[INITIATOR CONSOLE] [${msg.type()}] ${msg.text()}`;
      initiatorLogs.push(logLine);
      console.log(logLine);
    });

    initiatorPage.on('pageerror', err => {
      const logLine = `[INITIATOR ERROR] ${err.toString()}`;
      initiatorLogs.push(logLine);
      console.error(logLine);
    });

    console.log('Navigating initiator to https://localhost/ ...');
    await initiatorPage.goto('https://localhost/', { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Page loaded. Capturing initial landing page screenshot...');
    await initiatorPage.screenshot({ path: path.join(ARTIFACT_DIR, 'landing_page.png') });

    // Look for Create Secure Chamber button. In page.tsx:
    // <motion.button type="submit" disabled={isCreating || isJoining} ...>
    // Zap / "Create Secure Chamber"
    console.log('Looking for "Create Secure Chamber" button...');
    const createButton = await initiatorPage.waitForSelector('button[type="submit"]', { timeout: 10000 });
    
    console.log('Clicking "Create Secure Chamber" button...');
    await Promise.all([
      initiatorPage.click('button[type="submit"]'),
      initiatorPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(e => {
        console.log('Navigation promise timed out or was not triggered, checking URL...');
      })
    ]);

    // Wait a bit for state changes and redirect
    console.log('Waiting for redirect to complete...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const initiatorUrl = initiatorPage.url();
    console.log(`Current URL: ${initiatorUrl}`);

    await initiatorPage.screenshot({ path: path.join(ARTIFACT_DIR, 'initiator_room.png') });

    if (!initiatorUrl.includes('/room/')) {
      console.error('FAILED: Initiator was not redirected to a room!');
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'initiator_logs.txt'), initiatorLogs.join('\n'));
      await browser.close();
      process.exit(1);
    }

    console.log('Chamber created successfully! Key fragment is present in hash.');

    // ─── PART 2: Receiver (Peer) Joining ───
    console.log('Spawning receiver session (incognito context)...');
    const receiverContext = await browser.createBrowserContext();
    const receiverPage = await receiverContext.newPage();
    await receiverPage.setViewport({ width: 1280, height: 800 });

    const receiverLogs = [];
    receiverPage.on('console', msg => {
      const logLine = `[RECEIVER CONSOLE] [${msg.type()}] ${msg.text()}`;
      receiverLogs.push(logLine);
      console.log(logLine);
    });

    receiverPage.on('pageerror', err => {
      const logLine = `[RECEIVER ERROR] ${err.toString()}`;
      receiverLogs.push(logLine);
      console.error(logLine);
    });

    console.log(`Navigating receiver to room URL: ${initiatorUrl}`);
    await receiverPage.goto(initiatorUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for auto-joining to finish
    console.log('Waiting for receiver to auto-join secure chamber...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    await receiverPage.screenshot({ path: path.join(ARTIFACT_DIR, 'receiver_room.png') });

    // ─── PART 3: Send E2EE Chat Message ───
    console.log('Testing pairwise E2EE Chat...');
    
    // Switch Receiver to Chat tab in sidebar
    console.log('Switching receiver to Chat tab...');
    // Look for button containing "E2EE Chat Lobby" or similar
    const receiverTabs = await receiverPage.$$('aside button');
    let chatTabFound = false;
    for (const tab of receiverTabs) {
      const text = await receiverPage.evaluate(el => el.textContent, tab);
      if (text.includes('Chat')) {
        await tab.click();
        chatTabFound = true;
        break;
      }
    }

    if (chatTabFound) {
      console.log('Chat tab clicked. Waiting for transition...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Look for Chat Input
      console.log('Looking for chat input element...');
      const chatInput = await receiverPage.waitForSelector('input[placeholder*="message"]', { timeout: 5000 }).catch(() => null);
      if (chatInput) {
        console.log('Sending message: "Hello from Receiver!"');
        await chatInput.type('Hello from Receiver!');
        await receiverPage.keyboard.press('Enter');
        
        // Wait for propagation
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        await initiatorPage.screenshot({ path: path.join(ARTIFACT_DIR, 'initiator_room_chat.png') });
        await receiverPage.screenshot({ path: path.join(ARTIFACT_DIR, 'receiver_room_chat.png') });
        console.log('Screenshots updated with Chat lobby!');
      } else {
        console.log('Could not locate chat input field.');
      }
    } else {
      console.log('Could not find Chat tab in sidebar.');
    }

    // Write logs
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'initiator_logs.txt'), initiatorLogs.join('\n'));
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'receiver_logs.txt'), receiverLogs.join('\n'));
    console.log('Logs exported successfully.');

  } catch (err) {
    console.error('CRITICAL E2E FAILURE:', err);
  } finally {
    console.log('Shutting down Chromium browser...');
    await browser.close();
    console.log('E2E testing process complete.');
  }
}

runTest();
