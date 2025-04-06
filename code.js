let SPRSHEET = null;
let CONTEST_SHEET = null;
let CACHE_SERVICE = null;

// Cache names
const SESSION_COOKIE_CACHE_NAME = 'sessionCookie';
const LAST_CONTEST_CACHE_NAME = 'contestName';

const JSON_LENGTH_RANGE = "C2";
const RATE_UPDATED_RANGE = "D2";


function myFunction() {
    // helper();
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

/**
 * Check if a request to AtCoder goes through
 *
 * If not, report it to LINE and Discord.
 */
function healthCheck() {
    const MSG = "[Health check] Something's broken";
    const TEST_CONTEST = "abc389";
    const EXPECTED_JSON_LEN = 12393;

    const contestResultJson = getContestResultJSONNoLogin(TEST_CONTEST);
    if (contestResultJson === null) {
        console.error(`[${TEST_CONTEST}] Failed to get the result JSON`);
        sendMessagesLINE([MSG]);
        sendMsgDiscord(MSG);
        return;
    }

    try {
        if (contestResultJson.length !== EXPECTED_JSON_LEN) {
            const err_msg = `[${TEST_CONTEST}] JSON's length:\n\texpected: ${EXPECTED_JSON_LEN}, actual: ${contestResultJson.length}`
            console.error(err_msg);
            sendMessagesLINE([MSG]);
            sendMsgDiscord(MSG);
            return;
        }
    } catch (err) {
        console.error(`Checking JSON somehow failed!`);
        sendMessagesLINE([MSG]);
        sendMsgDiscord(MSG);
        return;
    }

    console.log(`[${TEST_CONTEST}] Result length: ${contestResultJson.length}`);
    console.log("Health check passed.");
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

    const contestResultJson = getContestResultJSONNoLogin(nextContestName);
    if (contestResultJson === null) {
        console.error(`[${nextContestName}] Failed to get the result JSON`);
        return;
    }
    console.log(`[${nextContestName}] JSON length: ${contestResultJson.length}`);

    if (isContestResultFixed(contestResultJson)) {
        console.log(`[${nextContestName}] Contest result is fixed`);
        updateSheetAndNotify(nextContestName);

        // It's a first check of the rate update for the contest.
        // So just record the JSON length (which should be greater than 0) and return,
        // as it might be in the middle of the JSON update.
        addContestJSONLengthAndFlagIntoSheet(contestResultJson.length, false);
        return;
    }

    console.log(`[${nextContestName}] Contest result is not fixed`);

    // But need to check if the rate for the last contest is updated.
    if (isRateUpdatedForLastFixedContest()) {
        console.log(`[${lastContestName}] Rate changes have been already notified`);
        return;
    }

    const lastContestResultJson = getContestResultJSONNoLogin(lastContestName);
    if (lastContestResultJson === null) {
        console.error(`[${lastContestName}] Failed to get the result JSON`);
        return;
    }
    console.log(`[${lastContestName}] JSON length: ${contestResultJson.length}`);

    previousJsonLength = getJSONLengthForLastFixedContest();
    if (lastContestResultJson.length === previousJsonLength) {
        // `previousJsonLength` must be greater than 0.
        // If the JSON length is not changing anymore, we consider it's completely updated.
        console.log(`[${lastContestName}] Ready to notify rate changes`);
        addContestJSONLengthAndFlagIntoSheet(lastContestResultJson.length, true);
        notifyNewRateInDiscord(lastContestResultJson, lastContestName);
    } else {
        // JSON is still being updated.
        addContestJSONLengthAndFlagIntoSheet(lastContestResultJson.length, false);
    }
}

function notifyIfContestFixed() {
    // Call the main logic only if it's in time range
    if (inTimeRange()) {
        helper();
    } else {
        console.log("Not in time range.");
    }
}

function getContestResultJSONNoLogin(contestName) {
    const contestStandingUrl = `https://atcoder.jp/contests/${contestName}/results/json`;
    const response = UrlFetchApp.fetch(contestStandingUrl);

    if (response.getResponseCode() !== 200) {
        console.error(`Request to ${contestStandingUrl} failed. Status code: ${response.getResponseCode()}`);
        console.log("HTML content:");
        console.log(response.getContentText("UTF-8"));
        return null;
    }

    const htmlText = response.getContentText();
    return JSON.parse(htmlText);
}

function isContestResultFixed(contestResultJson) {
    return contestResultJson.length > 0;
}

function clearCachedSession() {
    assignCacheService();
    CacheService.getScriptCache().remove(SESSION_COOKIE_CACHE_NAME);
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

/**
 * Checks if the current time is appropriate for polling AtCoder contest results
 *
 * Rationale: AtCoder ABC contests typically run Fri/Sat/Sun evenings. Results
 * are usually posted the same evening or the next morning. This function limits
 * checks to these likely periods to conserve resources (GAS's execution limit)
 *
 * Active Windows (Script's Time Zone):
 * - Fri: 19:00 onwards
 * - Sat: < 10:00 OR >= 19:00
 * - Sun: < 10:00 OR >= 19:00
 * - Mon: < 10:00
 * Checks are disabled on Tue, Wed, Thu.
 *
 * @returns {boolean} True if the current time is within an active check window.
 */
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

    sendMsgDiscord(msg);
}

function updateSheetAndNotify(contestName) {
    const contestURL = `https://atcoder.jp/contests/${contestName}`;
    let msg = `${contestName.toUpperCase()}の結果が更新されました。\n${contestURL}`;

    try {
        sendTweet(msg);
    } catch (err) {
        msg += '\n(But seems it failed to tweet.)';
        console.error("Failed to tweet.");
    }

    sendMessagesLINE([msg]);
    sendMsgDiscord(msg);
    addFixedContestNameIntoSheet(contestName);
}


/*** LINE API ***/
function sendMessagesLINEWithDest(messageList, destId) {
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

function sendMessagesLINE(messageList) {
    const DEBUG_GROUP_ID = PropertiesService.getScriptProperties().getProperty(
        "DEBUG_GROUP_ID"
    );
    sendMessagesLINEWithDest(messageList, DEBUG_GROUP_ID);
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
