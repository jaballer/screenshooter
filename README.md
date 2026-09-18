# ScreenShooter

ScreenShooter is a simple, automated website screenshot tool built using Node.js and Puppeteer. Paste a list of URLs or upload a CSV in its local web app, or run it from the command line, and it captures full-page screenshots and saves them locally.

## Features
- Local web app: paste URLs or upload a CSV, watch progress live, browse results in a gallery
- History of past runs, each saved in its own folder
- Command-line mode that reads website URLs from a CSV file
- Captures full-page screenshots with a customizable width
- Accepts bare domains (`github.com`) and local dev servers (`localhost:3000`)
- Supports environment variable configuration
- Error handling with detailed logging

## Requirements
- Node.js 18 or higher
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

### Web app
Start the server:
```sh
npm start
```
Then open [http://localhost:5055](http://localhost:5055). From there you can:
- Paste URLs, one per line. Put a name first (`Name, URL`) to choose the screenshot's filename.
- Or upload a CSV with a `url` column and an optional `name` column.
- Set the width, timeout, and headless mode for the run, then start it.
- Watch each site's progress live, cancel a run, and browse past runs in the History sidebar.

Each web run saves its screenshots in its own folder, `screenshots/<run-id>/`, next to a `run.json` file recording what happened. A web run can hold up to 1,000 sites; use the command line for bigger batches. The server only accepts connections from your own computer.

### Command line

#### 1. Configure Your Environment Variables
Create a `.env` file in the project root directory to customize settings (the web app uses these as its defaults):
```env
SCREENSHOT_WIDTH=1440    # Width of the viewport in pixels
HEADLESS_MODE=true      # Run browser in headless mode
TIMEOUT=60000           # Maximum time (ms) to wait for page load
CSV_FILE=websites.csv   # Input CSV filename
OUTPUT_DIR=screenshots  # Output directory for screenshots
PORT=5055               # Port for the web app
```

##### Environment Variables Explained
- `SCREENSHOT_WIDTH`: Sets the viewport width for screenshots (default: 1440px)
- `HEADLESS_MODE`: Runs the browser without a window unless set to `false` (default: true)
- `TIMEOUT`: Maximum time to wait for a page to load in milliseconds (default: 60000)
- `CSV_FILE`: Name of the input CSV file (default: websites.csv)
- `OUTPUT_DIR`: Directory where screenshots will be saved (default: screenshots)
- `PORT`: Port the web app listens on (default: 5055)

#### 2. Prepare the CSV File
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

The `name` column is optional. Rows without a name are named after their URL (for example `github.com-features-actions.png`).

#### 3. Run the Screenshot Script
Execute the following command:
```sh
# On Unix/Linux/MacOS/Windows
npm run capture

# Or run the script directly
node screenshot.js
```

The command exits with code `1` if any site fails, so it can be used in scripts.

#### 4. View Screenshots
Captured screenshots will be saved in the `screenshots/` folder (or the folder specified in `.env`). Command-line runs write directly into this folder and overwrite screenshots with the same name from earlier runs.

## Technical Details
- Screenshots are captured after the page reaches the `networkidle2` state (when there are no more than 2 network connections for at least 500ms)
- Failed screenshots are logged but won't stop the run
- The tool automatically adjusts screenshot height based on page content
- Screenshots are saved as PNG files, using the site's name as the filename
- Filenames are automatically sanitized (unsafe characters replaced, very long names shortened) and duplicate names get a numeric suffix, so no special-character handling is required in the CSV
- Only `http` and `https` URLs are captured. Domains without a scheme get `https://`, and local addresses (`localhost`, private IPs, `.test`) get `http://`. Rows that can't be used are skipped and listed with the reason
- CSV headers are matched case-insensitively, and files saved with a byte-order mark (for example from Excel) work

## Development
- `npm test` runs the test suite with Node's built-in test runner. The browser tests launch a real headless Chrome against a local page, so no internet connection is needed
- `src/` holds the shared code: `sites.js` (parsing and URL checks), `capture.js` (the Puppeteer capture loop), `runs.js` (web run folders and history), `filenames.js`, and `config.js`
- `server.js` is the web app's server, and `public/` holds its page. `screenshot.js` is the command-line entry point

## Known Limitations
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

## License
This project is licensed under the MIT License.

## Contributing
Feel free to open issues or submit pull requests to improve ScreenShooter!

## Support
If you encounter any issues or need assistance:
1. Check the Troubleshooting section
2. Open an issue on GitHub
3. Review existing issues for similar problems

