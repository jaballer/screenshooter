# ScreenShooter

ScreenShooter is a simple, automated website screenshot tool built using Node.js and Puppeteer. It reads website URLs from a CSV file and captures full-page screenshots, saving them locally.

## Features
- Reads website URLs from a CSV file
- Captures full-page screenshots with a customizable width
- Saves screenshots in a designated folder
- Supports environment variable configuration
- Automatically creates necessary directories

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
SCREENSHOT_WIDTH=1440
HEADLESS_MODE=true
TIMEOUT=60000
CSV_FILE=websites.csv
OUTPUT_DIR=screenshots
```

### 2. Prepare the CSV File
Copy the example file and edit it:
```sh
cp websites.example.csv websites.csv
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
node screenshot.js
```

### 4. View Screenshots
Captured screenshots will be saved in the `screenshots/` folder (or the folder specified in `.env`).

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

## License
This project is licensed under the MIT License.

## Contributing
Feel free to open issues or submit pull requests to improve ScreenShooter!

