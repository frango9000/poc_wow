const {chromium} = require('playwright');
const {resolve} = require('path');
const fs = require('fs');
const cheerio = require('cheerio');
const prettier = require('prettier');
const axios = require('axios');
require('dotenv').config();

function log(message, type) {
    console[type](`[${type.toUpperCase()}] ${new Date().toISOString()} | ${message}`);
}

function logInfo(message) {
    log(message, 'info');
}

function logWarn(message) {
    log(message, 'warn');
}

function logError(message) {
    log(message, 'error');
}

async function fetchRatingTable(url, selector) {
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
        ],
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
        await page.goto(url, {waitUntil: 'networkidle'});
        await page.waitForSelector(selector);
        const tableHTML = await page.$eval(selector, table => table.innerHTML);
        const $ = cheerio.load('<html><table class="rating">' + tableHTML + '</table></html>');
        const rows = $(selector).find('tr').slice(1);
        return rows.map((index, row) => {
            const cells = $(row).find('td');

            const characterLink = $(cells[0]).find('a');
            const guildLink = $(cells[1]).find('a');
            const realmLink = $(cells[3]).find('a');
            const dateSpan = $(cells[5]).find('span');

            return {
                character: {
                    name: characterLink.text().trim(),
                    url: characterLink.attr('href') || null,
                },
                guild: {
                    name: guildLink.text().trim(),
                    url: guildLink.attr('href') || null,
                },
                realm: {
                    name: realmLink.text().trim(),
                    url: realmLink.attr('href') || null,
                },
                date: dateSpan.attr('aria-label') || null,
            };
        }).get();
    } catch (error) {
        logError(error);
    } finally {
        await browser.close();
    }
}

async function updateTableData(data, outputFilePath) {
    const formattedJson = await prettier.format(JSON.stringify(data, null, 2), {parser: 'json'});
    fs.writeFileSync(outputFilePath, formattedJson, 'utf-8');
    logInfo('Data updated successfully');
}


function getPreviousData(outputFile) {
    try {
        let parsed = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function getNewData(previousData, currentData) {
    const newData = [];
    for (const entry of currentData) {
        if (previousData.find((prev) => prev.character.name === entry.character.name && prev.date === entry.date)) {
            break;
        }
        newData.push(entry);
    }
    return newData;
}

async function sendDiscordWebhook(data) {
    if (!data || !data.length) {
        logInfo('No new data to send');
        return;
    }
    const webhookId = process.env.WEBHOOK_ID;
    const webhookToken = process.env.WEBHOOK_TOKEN;
    if (!webhookId || !webhookToken) {
        logError('Webhook ID or token is missing');
        return;
    }
    const webhookURL = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;

    const payload = {
        content: 'Nueva persona buscando por guild!',
        username: 'Ojeador del Real Madrid',
        embeds: [
            ...data.map((entry) => ({
                title: entry.character.name,
                description: `${entry.character.name}: ${entry.guild.name} busca guild. (${entry.date})`,
                color: 16711680,
                fields:[
                    {
                        name: 'WoWProgress',
                        value: `[Link](https://www.wowprogress.com/character/eu/${entry.character.realm}/${entry.character.name})`,
                        inline: true,
                    },
                    {
                        name: 'WarcraftLogs',
                        value: `[Link](https://www.warcraftlogs.com/character/eu/${entry.character.realm}/${entry.character.name})`,
                        inline: true,
                    }
                ]
            })),
        ],
    };

    logInfo('Sending webhook...');
    return axios.post(webhookURL, payload)
}

async function main() {
    logInfo('Checking for new data...');
    const websiteUrl = 'https://www.wowprogress.com/gearscore/es?lfg=1&sortby=ts';
    const cssSelector = 'table.rating';

    const outputFile = resolve(process.cwd(), 'output', 'output.json');

    const previousData = getPreviousData(outputFile);
    const currentData = await fetchRatingTable(websiteUrl, cssSelector);

    if (previousData.length) {
        const newData = getNewData(previousData, currentData);
        logInfo('New data: ' + newData.length);
        if (newData.length) {
            sendDiscordWebhook(newData)
                .then(async (response) => {
                    logInfo('Webhook sent successfully: ' + response.status);
                    await updateTableData(currentData, outputFile);
                })
                .catch((error) => {
                    logError('Failed to send webhook: ' + error);
                });
        }
    } else {
        logInfo('No previous data found, initialing data');
        await updateTableData(currentData, outputFile);
    }
}

main().catch(console.error);
