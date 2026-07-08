import React from 'react';
import { render } from 'ink';
import App from '../tui/app';
import prisma from '../opensage/lib/prisma';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function init() {
  try {
    // Basic auth fallback: get the first user
    let userId = process.env.CLI_USER_ID;
    
    if (!userId) {
      const firstUser = await prisma.user.findFirst();
      if (!firstUser) {
        console.error('No users found in database. Please sign in via web first.');
        process.exit(1);
      }
      userId = firstUser.id;
    }

    // Pass the user context to the app
    const { cleanup } = render(<App userId={userId} />);
    
    // Ensure prisma is disconnected on exit
    process.on('SIGINT', async () => {
      cleanup();
      await prisma.$disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start TUI:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

init();
