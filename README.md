# ScreenShooter

ScreenShooter is a simple, automated website screenshot tool built using Node.js and Puppeteer. It reads website URLs from a CSV file and captures full-page screenshots, saving them locally.

## Features
- Reads website URLs from a CSV file
- Captures full-page screenshots with a customizable width
- Saves screenshots in a designated folder
- Supports environment variable configuration
- Automatically creates necessary directories
- Error handling with detailed logging

## Requirements
- Node.js 14.0 or higher
- 4GB RAM minimum (8GB recommended for large websites)
- Storage space for screenshots (varies based on usage)

## Installation

### Prerequisites
- [Node.js](https://nodejs.org/) installed

### Install Dependencies
```sh
npm install
```

## Usage

### 1. Configure Your Environment Variables
Create a `.env` file in the project root directory to customize settings:
```env
SCREENSHOT_WIDTH=1440    # Width of the viewport in pixels
HEADLESS_MODE=true      # Run browser in headless mode
TIMEOUT=60000           # Maximum time (ms) to wait for page load
CSV_FILE=websites.csv   # Input CSV filename
OUTPUT_DIR=screenshots  # Output directory for screenshots
```

#### Environment Variables Explained
- `SCREENSHOT_WIDTH`: Sets the viewport width for screenshots (default: 1440px)
- `HEADLESS_MODE`: When true, runs browser without GUI (default: true)
- `TIMEOUT`: Maximum time to wait for a page to load in milliseconds (default: 60000)
- `CSV_FILE`: Name of the input CSV file (default: websites.csv)
- `OUTPUT_DIR`: Directory where screenshots will be saved (default: screenshots)

### 2. Prepare the CSV File
Copy the example file and edit it:
```sh
# On Unix/Linux/MacOS
cp websites.example.csv websites.csv

# On Windows (Command Prompt)
copy websites.example.csv websites.csv
```

Edit `websites.csv` with your own list of websites in this format:
```csv
name,url
VS Code,https://code.visualstudio.com/
GitHub,https://github.com/
Postman,https://www.postman.com/
```

### 3. Run the Screenshot Script
Execute the following command:
```sh
# On Unix/Linux/MacOS/Windows
node screenshot.js

# On Windows (PowerShell)
node .\screenshot.js
```

### 4. View Screenshots
Captured screenshots will be saved in the `screenshots/` folder (or the folder specified in `.env`).

## Technical Details
- Screenshots are captured after the page reaches the `networkidle2` state (when there are no more than 2 network connections for at least 500ms)
- Failed screenshots are logged to console but won't stop the process
- The tool automatically adjusts screenshot height based on page content
- Screenshots are saved as PNG files using the 'name' field from the CSV as the filename

## Known Limitations
- The 'name' field in the CSV is used directly as the filename - avoid special characters
- Very long pages might require increased memory allocation
- Some websites might block automated access
- Dynamic content loading might require additional wait time

## Troubleshooting

### Common Issues

1. **Memory Issues**
   ```sh
   # Increase Node.js memory limit
   node --max-old-space-size=4096 screenshot.js
   ```

2. **Timeout Errors**
   - Increase the TIMEOUT value in .env
   - Check internet connection
   - Some websites might be blocking automated access

3. **Blank Screenshots**
   - Try increasing the TIMEOUT value
   - Check if the website requires authentication
   - Verify the website doesn't block automated access

4. **File Permission Errors**
   - Ensure write permissions in the output directory
   - Try running with administrator/sudo privileges if needed

## Memory Usage Guidelines
- Basic websites: 50-100MB per page
- Complex websites: 200-500MB per page
- Running multiple screenshots: Consider limiting concurrent operations
- For batch processing: Allow 2-4GB of available RAM

## Customization
### Modify Screenshot Width
Edit the `.env` file to change the width:
```env
SCREENSHOT_WIDTH=1920
```

### Adjust Timeout Settings
Increase the timeout for slower websites:
```env
TIMEOUT=120000
```

## Future Enhancements
- Add CLI arguments for dynamic CSV file input
- Implement scheduled screenshot captures
- Generate reports of captured screenshots
- Add support for authentication
- Add retry mechanism for failed screenshots
- Implement filename sanitization

## License
This project is licensed under the MIT License.

## Contributing
Feel free to open issues or submit pull requests to improve ScreenShooter!

## Support
If you encounter any issues or need assistance:
1. Check the Troubleshooting section
2. Open an issue on GitHub
3. Review existing issues for similar problems

