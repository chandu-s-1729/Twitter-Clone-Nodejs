const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const path = require("path");
const dbPath = path.join(__dirname, "./twitterClone.db");

let db = null;

const initializeDBAndServer = async (request, response) => {

    try {
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        app.listen(3000, () => {
            console.log("Server Running at http://localhost:3000/");
        });

    } catch (e) {
        console.log(`DB Error ${e.message}`);
        process.exit(1);
    }
};

initializeDBAndServer();

module.exports = app;

// API 1 - POST User Registration 
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    if (password.length < 6) {
        response.status(400);
        response.send("Password is too short");
    } else {
        const createUserQuery = `
            INSERT INTO 
                user (username, password, name, gender )
            VALUES 
                (
                '${username}',
                '${hashedPassword}',
                '${name}',
                '${gender}'
                );`;        
        const dbResponse = await db.run(createUserQuery);
        response.send("User created successfully");
    }   
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2 - POST User Login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {

      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "CHANDUKALISETTI");

      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Authentication Middleware Function 
const authenticateToken = async (request, response, next) => {
    let jwtToken;
    const authHeader = request.headers["authorization"];
    if (authHeader !== undefined) {
        jwtToken = authHeader.split(" ")[1];
    }
    if (jwtToken === undefined) {
        response.status(401);
        response.send("Invalid JWT Token");
    } else {
        jwt.verify(jwtToken, "CHANDUKALISETTI", async (error, payload) => {
        
        if (error) {
            response.status(401);
            response.send("Invalid JWT Token");
        } else {
            request.username = payload.username;
            next();
        }
    });
    }
};

// API 3 - Latest 4 tweets of people whom the user follows
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
    const { username } = request;

    const getTweetsOfUserFollowing = `
        SELECT
            user2.username AS username,
            tweet.tweet AS tweet,
            tweet.date_time AS dateTime
        FROM
            (user AS user1 INNER JOIN follower 
                ON user1.user_id = follower.follower_user_id)
            INNER JOIN user AS user2 
                ON user2.user_id = follower.following_user_id
            INNER JOIN tweet 
                ON follower.following_user_id = tweet.user_id
        WHERE 
            user1.username = '${username}'
        ORDER BY
                dateTime DESC
        LIMIT
                4;
    `;

    const tweetsOfUserFollowing = await db.all(getTweetsOfUserFollowing);
    response.send(tweetsOfUserFollowing);
});

// API 4 - GET List of all names of people whom the user follows
app.get("/user/following/", authenticateToken, async (request, response) => {
    const { username } = request;

    const getNamesOfUserFollowingQuery = `
        SELECT 
            user2.name AS name
        FROM 
            (user AS user1 INNER JOIN follower
                ON user1.user_id = follower.follower_user_id)
            INNER JOIN user AS user2
                ON user2.user_id = follower.following_user_id
        WHERE
            user1.username = '${username}';
    `;

    const namesOfUserFollowing = await db.all(getNamesOfUserFollowingQuery);
    response.send(namesOfUserFollowing);
});

// API 5 - GET List of all names of people who follows the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
    const { username } = request;

    const getNamesOfUserFollowerQuery = `
        SELECT 
            user1.name AS name
        FROM 
            (user AS user1 INNER JOIN follower
                ON user1.user_id = follower.follower_user_id)
            INNER JOIN user AS user2
                ON user2.user_id = follower.following_user_id
        WHERE
            user2.username = '${username}';
    `;

    const namesOfUserFollower = await db.all(getNamesOfUserFollowerQuery);
    response.send(namesOfUserFollower);
});

// API 6 - GET List of all Tweets by tweets ID
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserIdQuery = `SELECT user_id AS userId FROM user WHERE username = '${username}';`;
    const { userId } = await db.get(getUserIdQuery);

    const getTweetsByTweetIdQuery = `
        SELECT 
            tweet.tweet AS tweet,
            COUNT(like.like_id) AS likes,
            COUNT(reply.reply_id) AS replies,
            tweet.date_time AS dateTime
        FROM
            tweet JOIN reply 
                ON tweet.tweet_id = reply.tweet_id
                JOIN like 
                ON like.tweet_id = tweet.tweet_id
        WHERE
            tweet.tweet_id = ${tweetId} 
            AND tweet.tweet_id 
            IN 
            (
                SELECT 
                    tweet.tweet_id
                FROM 
                    follower JOIN tweet
                    ON follower.following_user_id = tweet.user_id
                WHERE 
                    follower.follower_user_id = ${userId}
            );
    `;
    
    const tweetsByTweetId = await db.get(getTweetsByTweetIdQuery);

    if (tweetsByTweetId.tweet === null) {
        response.status(401);
        response.send("Invalid Request");
    } else {
        response.send(tweetsByTweetId);
    }
});

// API 7 - GET List of all Names who like Tweet by tweets ID
app.get("/tweets/:tweetId/likes/", authenticateToken, async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserIdQuery = `SELECT user_id AS userId FROM user WHERE username = '${username}';`;
    const { userId } = await db.get(getUserIdQuery);

    const getNamesOfLikedByTweetIdQuery = `
        SELECT 
            DISTINCT user.username
        FROM
            tweet JOIN like 
                ON tweet.tweet_id = like.tweet_id
                JOIN user 
                ON user.user_id = like.user_id
        WHERE
            tweet.tweet_id = ${tweetId} 
            AND tweet.tweet_id 
            IN 
            (
                SELECT 
                    tweet.tweet_id
                FROM 
                    follower JOIN tweet
                    ON follower.following_user_id = tweet.user_id
                WHERE 
                    follower.follower_user_id = ${userId}
            );
    `;
    
    const likedPeople = await db.all(getNamesOfLikedByTweetIdQuery);

    if (likedPeople.length === 0) {
        response.status(401);
        response.send("Invalid Request");
    } else {
        const resultObject = {
            likes: []
        };

        likedPeople.forEach( (person) => { 
            resultObject.likes.push(person.username)
        });
        response.send(resultObject);
    }
});

// API 8 - GET List of all Names, Replies of who tweet by tweets ID
app.get("/tweets/:tweetId/replies/", authenticateToken, async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserIdQuery = `SELECT user_id AS userId FROM user WHERE username = '${username}';`;
    const { userId } = await db.get(getUserIdQuery);

    const getNamesAndRepliesByTweetIdQuery = `
        SELECT 
            DISTINCT user.name,
            reply.reply
        FROM
            tweet JOIN reply 
                ON tweet.tweet_id = reply.tweet_id
                JOIN user 
                ON user.user_id = reply.user_id
        WHERE
            tweet.tweet_id = ${tweetId} 
            AND tweet.tweet_id 
            IN 
            (
                SELECT 
                    tweet.tweet_id
                FROM 
                    follower JOIN tweet
                    ON follower.following_user_id = tweet.user_id
                WHERE 
                    follower.follower_user_id = ${userId}
            );
    `;

    const replieOfATweet = await db.all(getNamesAndRepliesByTweetIdQuery);

    if (replieOfATweet.length === 0) {
        response.status(401);
        response.send("Invalid Request");
    } else {
        const resultObject = {
            replies: []
        };

        replieOfATweet.forEach( (eachReply) => { 
            resultObject.replies.push(eachReply)
        });
        response.send(resultObject);
    }
});

// API 9 - GET List of all Tweets and Details of the User
app.get("/user/tweets/", authenticateToken, async (request, response) => {
    const { username } = request;

    const userTweetsQuery = `
        SELECT 
            tweet.tweet,
            COUNT(like.like_id) AS likes,
            COUNT(reply.reply_id) AS replies,
            tweet.date_time AS dateTime
        FROM 
            user JOIN tweet 
                ON user.user_id = tweet.user_id
                LEFT JOIN reply 
                ON reply.tweet_id = tweet.tweet_id
                LEFT JOIN like
                ON like.tweet_id = tweet.tweet_id
        WHERE 
            user.username = '${username}'
        GROUP BY 
            tweet.tweet_id;
    `;

    const userTweetsDetails = await db.all(userTweetsQuery);
    response.send(userTweetsDetails);
});

// API 10 - POST Creating a tweet in the tweet table
app.post("/user/tweets/", authenticateToken, async (request, response) => {
    const { username } = request;
    const { tweet } = request.body;
    const userIdQuery = `SELECT user_id AS userId FROM user WHERE username = '${username}';`;
    const { userId } = await db.get(userIdQuery);

    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();

    const postTweetQuery = `
        INSERT INTO
            tweet (tweet,user_id,date_time)
        VALUES
        (
            '${tweet}',
             ${userId},
            '${year}-${month}-${day} ${hour}:${minute}:${second}'
        );
    `;
        
    await db.run(postTweetQuery);
    response.send("Created a Tweet");
});

// API 11 - DELETE Deleting a tweet by tweet ID of user
app.delete("/tweets/:tweetId/", authenticateToken, async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserTweetsQuery = `
        SELECT 
            tweet.tweet_id
        FROM 
            user NATURAL JOIN tweet
        WHERE 
            user.username = '${username}';
    `;
    const userTweets = await db.all(getUserTweetsQuery);

    const isUserTweet = userTweets.some( (tweet) => 
        tweet.tweet_id === parseInt(tweetId)
    );

    if (isUserTweet === false) {
        response.status(401);
        response.send("Invalid Request");
    } else {
        const deleteTweetQuery = `
            DELETE FROM
                tweet
            WHERE 
                tweet_id = ${tweetId};
        `;

        await db.run(deleteTweetQuery);
        response.send("Tweet Removed");
    }
});