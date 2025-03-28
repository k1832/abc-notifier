let SPRSHEET = null;
let CONTEST_SHEET = null;
let CACHE_SERVICE = null;

// Cache names
const SESSION_COOKIE_CACHE_NAME = 'sessionCookie';
const LAST_CONTEST_CACHE_NAME = 'contestName';

const JSON_LENGTH_RANGE = "C2";
const RATE_UPDATED_RANGE = "D2";


function myFunction() {
    helper();
    // assignContestSheet();
    // const flag = CONTEST_SHEET.getRange(RATE_UPDATED_RANGE).getValue();
    // if (flag === true) {
    //     console.log('true');
    // } else if (flag === false) {
    //     console.log('false');
    // } else {
    //     console.log('else');
    // }
    // clearCachedSession();
    // helper();
    // notifyDiscordLastContestResult();
}

/*
 * Updated version with login
 */

/**
 * Parses the hardcoded session cookie to extract the expiry timestamp.
 * @returns {number|null} The Unix timestamp (in seconds) of expiry, or null if not found/invalid.
 */
function getSessionExpiryTimestamp() {
    const ATCODER_SESSION =
        PropertiesService.getScriptProperties().getProperty("ATCODER_SESSION");
    try {
        // Ensure the cookie variable is accessible
        if (!ATCODER_SESSION || typeof ATCODER_SESSION !== 'string') {
            console.error("Hardcoded session cookie is not defined or not a string.");
            return null;
        }

        // Find the _TS part
        const tsRegex = /_TS%3A(\d+)/; // Use regex to find _TS: followed by digits
        const match = ATCODER_SESSION.match(tsRegex);

        if (match && match[1]) {
            const timestampSeconds = parseInt(match[1], 10);
            if (!isNaN(timestampSeconds)) {
                return timestampSeconds;
            } else {
                 console.error("Failed to parse timestamp value from session cookie.");
                 return null;
            }
        } else {
            console.error("Could not find '_TS:' timestamp in the hardcoded session cookie.");
            return null;
        }
    } catch (e) {
        console.error("Error parsing session cookie timestamp: " + e);
        return null;
    }
}

function getFormattedSessionExpiryDate() {
    const expiryTimestampSeconds = getSessionExpiryTimestamp();
    if (!expiryTimestampSeconds) return null;

    const expiryDate = new Date(expiryTimestampSeconds * 1000);
    const scriptTimeZone = Session.getScriptTimeZone(); // Get script's timezone for formatting
    const formattedExpiryDate = Utilities.formatDate(expiryDate, scriptTimeZone, "yyyy-MM-dd HH:mm:ss z");
    return formattedExpiryDate;
}

function assignCacheService() {
    if (CACHE_SERVICE) return;

    CACHE_SERVICE = CacheService.getScriptCache();
}

function getLastContestName() {
    assignCacheService();

    let lastContestName = CACHE_SERVICE.get(LAST_CONTEST_CACHE_NAME);
    if (lastContestName)
        return lastContestName;

    assignContestSheet();
    lastContestName = CONTEST_SHEET.getRange("B2").getValue();
    CACHE_SERVICE.put(LAST_CONTEST_CACHE_NAME, lastContestName, 3600);
    return lastContestName;
}

// Actual logic
// This function does 2 things
// - Check if the next contest result is fixed. If yes, notify in various ways (X, Discord, LINE).
//     "contest result is fixed" means that all users' rates are updated.
//     But this does NOT mean that all users' rate changes are included
//     in the contest result JSON.
// - Check if the result JSON (of the last-fixed contest) is completely updated. If yes, notify rate changes in Discord.
function helper() {
    assignContestSheet();
    const lastContestName = getLastContestName();
    const lastContestNumber = parseInt(lastContestName.substr(3));
    const nextContestName = `abc${lastContestNumber + 1}`;
    console.log(`Next contest: ${nextContestName}`)

    const SLEEP_DURATION = 1000;

    const TRIAL_COUNT = 2;
    for (let i = 1; i <= TRIAL_COUNT; ++i) {
        const sessionCookie = loginAndGetSessionCookie();
        if (sessionCookie === null) {
            console.error("Something went wrong while getting the session cookie.");
            if (i + 1 <= TRIAL_COUNT) {
                console.log(`Sleeping for ${SLEEP_DURATION}ms before retrying`);
                Utilities.sleep(SLEEP_DURATION);
            }
            continue;
        }

        const contestResultJson = getContestResultJSON(nextContestName, sessionCookie);
        if (contestResultJson === null) {
            console.error(`Failed to get the contest result JSON for ${nextContestName}.`);
            if (i + 1 <= TRIAL_COUNT) {
                console.log(`Sleeping for ${SLEEP_DURATION} ms before retrying`);
                Utilities.sleep(SLEEP_DURATION);
            }
            continue;
        }
        console.log(`Length of the contest ${nextContestName} result is ${contestResultJson.length}`)

        if (isContestFixed(contestResultJson)) {
            console.log("Contest result is fixed.");
            updateSheetAndNotify(nextContestName);

            // It's a first check of the rate update for the contest.
            // So just record the JSON length (which should be greater than 0) and return,
            // as it might be in the middle of the JSON update.
            addContestJSONLengthAndFlagIntoSheet(contestResultJson.length, false);
            return;
        } else {
            console.log(`Contest result is not fixed yet for ${nextContestName}.`);
        }

        // The next contest result is not fixed

        // But need to check if the rate for the last contest is updated.
        if (isRateUpdatedForLastFixedContest()) {
            console.log(`Rate changes have been already notified for ${lastContestName}.`);
            return;
        }

        const lastContestResultJson = getContestResultJSON(lastContestName, sessionCookie);
        if (lastContestResultJson === null) {
            console.error(`Failed to get the contest result JSON for ${lastContestName}.`);
            if (i + 1 <= TRIAL_COUNT) {
                console.log(`Sleeping for ${SLEEP_DURATION}ms before retrying`);
                Utilities.sleep(SLEEP_DURATION);
            }
            continue;
        }
        console.log(`Length of the contest ${lastContestName} result is ${lastContestResultJson.length}`)

        previousJsonLength = getJSONLengthForLastFixedContest();
        if (lastContestResultJson.length === previousJsonLength) {
            // `previousJsonLength` must be greater than 0.
            // If the JSON length is not changing anymore, we consider it's completely updated.
            console.log(`Ready to notify rate changes for ${lastContestName}.`)
            addContestJSONLengthAndFlagIntoSheet(lastContestResultJson.length, true);
            notifyNewRateInDiscord(lastContestResultJson, lastContestName);
        } else {
            // JSON is still being updated.
            addContestJSONLengthAndFlagIntoSheet(lastContestResultJson.length, false);
        }
        // No need to retry at this point. Just return.
        return;
    }

    throw new Error("Failed to get contest data.");
}

function notifyIfContestFixed() {
    // Call the main logic only if it's in time range
    if (inTimeRange()) {
        helper();
    } else {
        console.log("Not in time range.");
    }
}

function getContestResultJSON(contestName, sessionCookie) {
    const options = {
        muteHttpExceptions: true,
        headers: {
            'Cookie': sessionCookie
        },
        followRedirects: false,
    };

    const contestStandingUrl = `https://atcoder.jp/contests/${contestName}/results/json`;
    const response = UrlFetchApp.fetch(contestStandingUrl, options);

    if (response.getResponseCode() !== 200) {
        console.error(`Request to ${contestStandingUrl} failed. Status code: ${response.getResponseCode()}`);
        console.log("HTML content:")
        console.log(response.getContentText("UTF-8"));
        return null;
    }

    const htmlText = response.getContentText();
    return JSON.parse(htmlText);
}

function isContestFixed(contestResultJson) {
    return contestResultJson.length > 0;
}

function decodeHtmlEntities(str) {
    return str.replace(/&#(\d+);/g, function (_, dec) {
        return String.fromCharCode(dec);
    });
}

function clearCachedSession() {
    assignCacheService();
    CacheService.getScriptCache().remove(SESSION_COOKIE_CACHE_NAME);
}

/* This function caches the session */
function loginAndGetSessionCookie() {
    // HACK: Use the hardcoded session because AtCoder changed
    //       how to login.

    // Value of REVEL_SESSION (the prefix "REVEL_SESSION=" is not needed)
    const ATCODER_SESSION =
        PropertiesService.getScriptProperties().getProperty("ATCODER_SESSION");
    return ATCODER_SESSION;

    assignCacheService();
    const cachedSessionCookie = CACHE_SERVICE.get(SESSION_COOKIE_CACHE_NAME);
    if (cachedSessionCookie) {
        return cachedSessionCookie;
    }

    console.log("Not found cached session cookie. Getting new one.");

    const LOGIN_URL = 'https://atcoder.jp/login';

    // Step 1: Fetch the login page and extract the CSRF token
    let response = UrlFetchApp.fetch(LOGIN_URL, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
        console.error(`Login request to ${LOGIN_URL} failed. Status code: ${response.getResponseCode()}`);
        console.log("HTML content:")
        console.log(response.getContentText("UTF-8"));
        return null;
    }

    const html = response.getContentText("UTF-8");
    const csrfTokenRegex = /<input type="hidden" name="csrf_token" value="([^"]+)".*>/;
    const csrfTokenMatch = csrfTokenRegex.exec(html);
    if (!csrfTokenMatch) {
        console.error("Failed to find the CSRF token.");
        return null;
    }

    const csrfToken = decodeHtmlEntities(csrfTokenMatch[1]);

    // Step 2: Send a POST request with your login credentials and the extracted CSRF token
    const username = PropertiesService.getScriptProperties().getProperty("ATCODER_USERNAME");
    const password = PropertiesService.getScriptProperties().getProperty("ATCODER_PASSWORD");
    const payload = {
        username: encodeURIComponent(username),
        password: encodeURIComponent(password),
        csrf_token: encodeURIComponent(csrfToken)
    };

    const formData = `username=${payload.username}&password=${payload.password}&csrf_token=${payload.csrf_token}`;

    const options = {
        method: 'post',
        payload: formData,
        muteHttpExceptions: true,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': response.getAllHeaders()['Set-Cookie'].join('; ')
        },
        followRedirects: false,
    };

    response = UrlFetchApp.fetch(LOGIN_URL, options);
    if (response.getResponseCode() < 300 || response.getResponseCode() >= 400) {
        console.error(`Login request to ${LOGIN_URL} failed. Status code: ${response.getResponseCode()}`);
        console.log("HTML content:")
        console.log(response.getContentText("UTF-8"));
        return null;
    }

    const redirectLocation = response.getHeaders()['Location'];
    if (redirectLocation != "/home") {
        console.log({ redirectLocation })
        console.error("Failed to login. Maybe wrong username or password?");
        return null;
    }

    console.log("Successfully logged in to AtCoder.")

    // Step 3: Extract the session cookie and cache it
    const setCookieArray = response.getAllHeaders()['Set-Cookie'];
    const sessionCookie = setCookieArray.find(cookie => cookie.startsWith('REVEL_SESSION')).split(';')[0];

    CACHE_SERVICE.put(SESSION_COOKIE_CACHE_NAME, sessionCookie, 3600);

    return sessionCookie;
}

/** Update sheets */
function assignSPRSHEET() {
    if (SPRSHEET) return;
    SPRSHEET = SpreadsheetApp.getActiveSpreadsheet();
}

function assignContestSheet() {
    if (CONTEST_SHEET) return;

    assignSPRSHEET();
    CONTEST_SHEET = SPRSHEET.getSheetByName("contest-list");
}
/** Update sheets */

function inTimeRange() {
    const now = new Date();

    // 0   1   2   3   4   5   6
    // Sun Mon Tue Wed Thu Fri Sat
    const day = now.getDay();
    const hours = now.getHours();

    // Assuming contests are on Fri-Sun

    if (day === 0 || day === 6) {
        // Sun or Sat
        return hours < 10 || hours >= 19; // Morning or evening
    } else if (day === 1) {
        // Mon
        return hours < 10; // Morning
    } else if (day === 5) {
        // Fri
        return hours >= 19; // Evening
    } else {
        return false;
    }
}

function addFixedContestNameIntoSheet(contestName) {
    assignContestSheet();
    CONTEST_SHEET.insertRowBefore(2);
    CONTEST_SHEET.getRange("A2:B2").setValues([[new Date(), contestName]]);
    console.log(`${contestName} is added to the sheet as a fixed contest.`)

    assignCacheService();
    CACHE_SERVICE.put(LAST_CONTEST_CACHE_NAME, contestName, 3600);
}

function getJSONLengthForLastFixedContest() {
    assignContestSheet();
    return CONTEST_SHEET.getRange(JSON_LENGTH_RANGE).getValue();
}

function isRateUpdatedForLastFixedContest() {
    assignContestSheet();
    return CONTEST_SHEET.getRange(RATE_UPDATED_RANGE).getValue();
}

function addContestJSONLengthAndFlagIntoSheet(jsonLength, isRateUpdated) {
    assignContestSheet();
    CONTEST_SHEET.getRange(JSON_LENGTH_RANGE).setValue(jsonLength);
    CONTEST_SHEET.getRange(RATE_UPDATED_RANGE).setValue(isRateUpdated);
}

/**
 * Notify rate changes to users. (This function assumes the result JSON is completely updated.)
 */
function notifyNewRateInDiscord(contestResultJson, contestName) {
    const atcoderBaseURL = "https://atcoder.jp";
    const contestURL = `${atcoderBaseURL}/contests/${contestName}`;
    const upperContestName = contestName.toUpperCase();
    const contestURLMarkdown = `[${upperContestName}](${contestURL})`;
    let msg = `[${contestURLMarkdown}後のレート変化]`;

    // Author & his friends
    const discordUsers = new Set(["k1832", "maeda__1221", "oirom0528"]);
    let participated = false;
    for (let i = 0; (i < contestResultJson.length) && (discordUsers.size > 0); ++i) {
        const userScreenName = contestResultJson[i].UserScreenName;
        if (!discordUsers.has(userScreenName)) continue;

        console.log(`Found user: ${userScreenName}`)
        discordUsers.delete(userScreenName);

        const userPageURL = `${atcoderBaseURL}/users/${userScreenName}`;

        const oldRating = contestResultJson[i].OldRating;
        const newRating = contestResultJson[i].NewRating;
        const isRated = contestResultJson[i].IsRated;
        msg += "\n";
        msg += `[${userScreenName}](${userPageURL})`; // Markdown link for the user
        msg += `: ${oldRating} -> ${newRating}`;

        if (isRated) {
            participated = true;
        } else {
            msg += " (Unrated)";
            continue;
        }

        if (Math.floor(oldRating / 400) != Math.floor(newRating / 400)) {
            // Rating color changed
            if (newRating > oldRating) {
                msg += ` (+${newRating - oldRating})`;
                msg += "\n色変おめでとう！！🎉😻🎉";
            } else {
                msg += ` (-${oldRating - newRating})`;
                msg += "\n今日はやけ酒😭😭😭";
            }
        } else {
            if (newRating == oldRating) {
                msg += " (±0) 😐";
            } else if (newRating > oldRating) {
                msg += ` (+${newRating - oldRating}) 🎉`;
            } else {
                msg += ` (-${oldRating - newRating}) 😭`;
            }
        }
    }

    if (!participated) {
        msg += "\n誰もRatedで参加しなかったようだ👎";
    }

    const sessionExpiryDate = getFormattedSessionExpiryDate();
    if (sessionExpiryDate) {
        msg += `\nデバッグ情報: Next session expiry: ${getFormattedSessionExpiryDate()}`;
    } else {
        msg += `\nデバッグ情報: Failed to get session expiry date.`;
    }

    sendMsgDiscord(msg);
}

function updateSheetAndNotify(contestName) {
    const contestURL = `https://atcoder.jp/contests/${contestName}`;
    let msg = `${contestName.toUpperCase()}の結果が更新されました。\n${contestURL}`;

    try {
        sendTweet(msg);
    } catch (err) {
        msg += '\n(But it seems to failed to tweet.)';
        console.error("Failed to tweet.");
    }

    const DEBUG_GROUP_ID = PropertiesService.getScriptProperties().getProperty(
        "DEBUG_GROUP_ID"
    );
    sendMessages([msg], DEBUG_GROUP_ID);
    sendMsgDiscord(msg);
    addFixedContestNameIntoSheet(contestName);
}


/*** LINE API ***/
function sendMessages(messageList, destId) {
    if (!messageList.length) return;

    const url = "https://api.line.me/v2/bot/message/push";
    const messages = [];
    messageList.forEach(message => {
        messages.push({ type: "text", text: message });
    });
    const postData = { to: destId, messages };
    const LINE_TOKEN = PropertiesService.getScriptProperties().getProperty(
        "LINE_TOKEN"
    );
    const options = {
        method: "post",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LINE_TOKEN}`
        },
        payload: JSON.stringify(postData)
    };
    UrlFetchApp.fetch(url, options);
}


/*** Twitter API ***/
// https://tech-cci.io/archives/4228
function getOAuthURL() {
    console.log(getService().authorize());
}

function authCallback(request) {
    const service = getService();
    const authorized = service.handleCallback(request);
    if (authorized) {
        return HtmlService.createHtmlOutput('success!!');
    } else {
        return HtmlService.createHtmlOutput('failed');
    }
}

function getService() {
    return OAuth1.createService('twitter')
        .setAccessTokenUrl('https://api.twitter.com/oauth/access_token')
        .setRequestTokenUrl('https://api.twitter.com/oauth/request_token')
        .setAuthorizationUrl('https://api.twitter.com/oauth/authorize')
        // 設定した認証情報をセット
        .setConsumerKey(PropertiesService.getScriptProperties().getProperty("CONSUMER_KEY"))
        .setConsumerSecret(PropertiesService.getScriptProperties().getProperty("CONSUMER_SECRET"))
        .setCallbackFunction('authCallback')
        // 認証情報をプロパティストアにセット（これにより認証解除するまで再認証が不要になる）
        .setPropertyStore(PropertiesService.getUserProperties());
}

function sendTweet(tweet_content) {
    // https://teratail.com/questions/7hpblpvia6ut5m
    const twitterService = getService();

    if (twitterService.hasAccess()) {
        const payload = {
            text: tweet_content
        }
        const options = {
            "method": "post",
            "muteHttpExceptions": true,
            'contentType': 'application/json',
            'payload': JSON.stringify(payload)
        }

        const response = JSON.parse(twitterService.fetch("https://api.twitter.com/2/tweets", options));
        console.log(`Posted tweet:\n${tweet_content}`);
    } else {
        console.error(`Could not post tweet:\n${tweet_content}`);
        throw new Error("Twitter auth seemed to fail.");
    }
}

function sendMsgDiscord(msg) {
    const MRK_WEBHOOK_URL = PropertiesService.getScriptProperties().getProperty("DISCORD_MRK_WEBHOOK_URL");
    const payload = {
        content: msg,
    };

    UrlFetchApp.fetch(MRK_WEBHOOK_URL, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
    });
}
