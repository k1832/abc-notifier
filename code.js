let SPRSHEET = null;
let CONTEST_SHEET = null;
let CACHE_SERVICE = null;

// Cache names
const SESSION_COOKIE_CACHE_NAME = 'sessionCookie';
// TODO(k1832): Consider caching next contest name instead of last
const LAST_CONTEST_CACHE_NAME = 'contestName';

let contestResultJson = null;

let nextContestName = null;

function myFunction() {
    clearCachedSession();
    helper();
}

/*
 * Updated version with login
 */

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
function helper() {
    assignContestSheet();
    const lastContestName = getLastContestName();
    const lastContestNumber = parseInt(lastContestName.substr(3));
    nextContestName = `abc${lastContestNumber + 1}`;
    console.log(`Next contest: ${nextContestName}`)

    const username = PropertiesService.getScriptProperties().getProperty("ATCODER_USERNAME");
    const password = PropertiesService.getScriptProperties().getProperty("ATCODER_PASSWORD");

    const TRIAL_COUNT = 2;
    for (let i = 1; i <= TRIAL_COUNT; ++i) {
        const fixed = isContestFixed(username, password, nextContestName);

        if (fixed === true) {
            updateSheetAndNotify();
            console.log("Contest result is fixed.");
            return;
        }

        if (fixed === false) {
            console.log("Contest result is NOT fixed.");
            return;
        }

        console.error("Something's wrong!!");
        if (i + 1 <= TRIAL_COUNT) {
            console.log(`Retrying.. ${i + 1} / ${TRIAL_COUNT}`);
            Utilities.sleep(3000);
        }
    }

    throw new Error("Failed to get contest data.");
}

function notifyIfContestFixed() {
    // Main function that wraps with time range validation
    if (!inTimeRange()) {
        return;
    }
    helper();
}

function isContestFixed(username, password, contestName) {
    const sessionCookie = loginAndGetSessionCookie(username, password);
    if (sessionCookie === null) {
        console.error("Something's wrong!");
        return null;
    }

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
    contestResultJson = JSON.parse(htmlText);

    const resultLength = contestResultJson.length;
    if (typeof (resultLength) !== "number") {
        console.error("Contest result JSON is not an array.");
        console.log(`contestResultJson: ${contestResultJson}`);
        return null;
    }

    return resultLength > 0;
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
function loginAndGetSessionCookie(username, password) {
    assignCacheService();
    const cachedSessionCookie = CACHE_SERVICE.get(SESSION_COOKIE_CACHE_NAME);
    if (cachedSessionCookie) {
        console.log("Found cached session cookie!");
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
    const day = now.getDay();

    // 0   1   [2   3   4  ] 5   6
    // Sun Mon [Tue Wed Thu] Fri Sat
    if ([2, 3, 4].includes(day)) {
        console.log("It's NOT in time range.");
        return false;
    }

    const hours = now.getHours();

    if (hours < 10 && [0, 1, 6].includes(day)) {
        // Morning
        console.log("It's in time range.");
        return true;
    }

    if (hours >= 19 && [0, 5, 6].includes(day)) {
        // Evening
        console.log("It's in time range.");
        return true;
    }

    console.log("It's NOT in time range.");
    return false;
}

function addNextContestIntoSheet() {
    assignContestSheet();
    CONTEST_SHEET.insertRowBefore(2);
    CONTEST_SHEET.getRange("A2:B2").setValues([[new Date(), nextContestName]]);
    console.log(`${nextContestName} is added to the sheet.`)

    assignCacheService();
    CACHE_SERVICE.put(LAST_CONTEST_CACHE_NAME, nextContestName, 3600);
}

function notifyInDiscord(msg) {
    // Author & his friends
    const discordUsers = new Set(["k1832", "maeda__1221", " oirom0528"]);
    let participated = false;
    for (let i = 0; i < contestResultJson.length; ++i) {
        const userScreenName = contestResultJson[i].UserScreenName;
        if (!discordUsers.has(userScreenName)) continue;

        discordUsers.delete(userScreenName);
        participated = true;

        const oldRating = contestResultJson[i].OldRating;
        const newRating = contestResultJson[i].NewRating;
        msg += `\n${userScreenName}: ${oldRating} -> ${newRating}`;
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

        if (discordUsers.size === 0) break;
    }

    if (!participated) {
        msg += "\nNo one participated as rated in this contest 👎";
    }
    sendMsgDiscord(msg);
}

function updateSheetAndNotify() {
    const contestURL = `https://atcoder.jp/contests/${nextContestName}`;
    let msg = `${nextContestName.toUpperCase()}の結果が更新されました。\n${contestURL}`;

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
    addNextContestIntoSheet();

    /*
     * Low priority. Should be at the end of the function
     * to avoid disturbing other notifications.
     */
    notifyInDiscord(msg);
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
