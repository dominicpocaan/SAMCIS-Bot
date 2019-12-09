// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityHandler, MessageFactory } = require('botbuilder');
const { LuisRecognizer, QnAMaker } = require('botbuilder-ai');

// The accessor names for the conversation flow and user profile state property accessors.
const CONVERSATION_FLOW_PROPERTY = 'CONVERSATION_FLOW_PROPERTY';
const LOCATE_FACILITY_PROPERTY = 'LOCATE_FACILITY_PROPERTY';

global.dialogStatus = false;
global.firstPrediction = true;

// Identifies the last question asked.
const question = {
    tolocation: 'tolocation',
    fromlocation: 'fromlocation',
    none: 'none'
};

class SamcisBot extends ActivityHandler {
    constructor(conversationState, userState) {
        super();

        // The state property accessors for conversation flow and user profile.
        this.conversationFlow = conversationState.createProperty(CONVERSATION_FLOW_PROPERTY);
        this.locateFacility = userState.createProperty(LOCATE_FACILITY_PROPERTY);

        // The state management objects for the conversation and user.
        this.conversationState = conversationState;
        this.userState = userState;

        // If the includeApiResults parameter is set to true, as shown below, the full response
        // from the LUIS api will be made available in the properties  of the RecognizerResult
        const dispatchRecognizer = new LuisRecognizer({
            applicationId: process.env.DispatchLuisAppId,
            endpointKey: process.env.DispatchLuisAPIKey,
            endpoint: `https://${ process.env.DispatchLuisAPIHostName }.api.cognitive.microsoft.com`
        }, {
            includeAllIntents: true,
            includeInstanceData: true
        }, true);

        const friendlyChat = new QnAMaker({
            knowledgeBaseId: process.env.FriendlyChatQnAKnowledgebaseId,
            endpointKey: process.env.FriendlyChatQnAEndpointKey,
            host: process.env.FriendlyChatQnAEndpointHostName
        });

        const universityHistory = new QnAMaker({
            knowledgeBaseId: process.env.EventHistoryQnAKnowledgebaseId,
            endpointKey: process.env.EventHistoryQnAEndpointKey,
            host: process.env.EventHistoryQnAEndpointHostName
        });

        this.dispatchRecognizer = dispatchRecognizer;
        this.friendlyChat = friendlyChat;
        this.eventHistory = universityHistory;

        this.onMessage(async (context, next) => {
            console.log('Processing Message Activity.');

            // First, we use the dispatch model to determine which cognitive service (LUIS or QnA) to use.
            const recognizerResult = await dispatchRecognizer.recognize(context);

            var intent = undefined;

            if (dialogStatus) {
                intent = 'LocateFacility';
            } else {
                // Top intent tell us which cognitive service to use.
                intent = LuisRecognizer.topIntent(recognizerResult);
            }

            // Next, we call the dispatcher with the top intent.
            await this.dispatchToTopIntentAsync(context, intent, recognizerResult);

            await next();
        });

        this.onMembersAdded(async (context, next) => {
            console.log('onMembersAdded');

            const membersAdded = context.activity.membersAdded;
            for (let cnt = 0; cnt < membersAdded.length; cnt++) {
                if (membersAdded[cnt].id !== context.activity.recipient.id) {
                    await context.sendActivity('Hello, I am Slug an AI chat-bot. How may I help you?');
                    await this.sendSuggestedActions(context);
                }
            }

            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });

        this.onDialog(async (context, next) => {
            // Save any state changes. The load happened during the execution of the Dialog.
            await this.conversationState.saveChanges(context, false);
            await this.userState.saveChanges(context, false);

            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });
    }

    async dispatchToTopIntentAsync(context, intent, recognizerResult) {
        console.log('dispatchToTopIntentAsync');

        switch (intent) {
            case 'LocateFacility':
                // await context.sendActivity('LocateFacility intent');
                await this.processLocateFacility(context, recognizerResult.luisResult);
                break;
            case 'FriendlyChat':
                // await context.sendActivity('FriendlyChat KB: ');
                await this.processFriendlyChat(context);
                break;
            case 'EventHistory':
                // await context.sendActivity('UniversityHistory KB');
                await this.processEventHistory(context);
                break;
            default:
                console.log(`Dispatch unrecognized intent: ${ intent }.`);
                await context.sendActivity(`Dispatch unrecognized intent: ${ intent }.`);
                break;
        }
    }

    async processLocateFacility(context, luisResult) {
        console.log('processLocateFacility');

        const flow = await this.conversationFlow.get(context, { lastQuestionAsked: question.none });
        const locate = await this.locateFacility.get(context, {});

        if (firstPrediction) {
            if (luisResult.entities.length > 0) {

                var foundToLocation = false;
                var foundFromLocation = false;

                for (var i = 0; i < luisResult.entities.length; i++) {
                    if (luisResult.entities[i].type === "ToLocation") {
                        foundToLocation = true;
                        locate.tolocation = luisResult.entities[i].entity;
                    }
                    if (luisResult.entities[i].type === "FromLocation") {
                        foundFromLocation = true;
                        locate.fromlocation = luisResult.entities[i].entity;
                    }
                }

                if (foundToLocation) {
                    flow.lastQuestionAsked = question.tolocation;
                }

                if (foundFromLocation) {
                    flow.lastQuestionAsked = question.fromlocation;
                }
            }
        }
        
        dialogStatus = true;
        await SamcisBot.fillOutUserLocation(flow, locate, context);
    }

    async processFriendlyChat(context) {
        console.log("processFriendlyChat");

        const results = await this.friendlyChat.getAnswers(context);
        
        if (results.length > 0) {
            await context.sendActivity(`${ results[0].answer }`);
        } else {
            await context.sendActivity('Sorry, could not find an answer in the Q and A system.');
        }
    }

    async processEventHistory(context) {
        console.log("processUniversityHistory");

        const results = await this.eventHistory.getAnswers(context);
        
        if (results.length > 0) {
            await context.sendActivity(`${ results[0].answer }`);
        } else {
            await context.sendActivity('Sorry, could not find an answer in the Q and A system.');
        }
    }

    async sendSuggestedActions(turnContext) {
        console.log('sendSuggestedActions');

        var reply = MessageFactory.suggestedActions(['Hi!', 'Hello!']);
        await turnContext.sendActivity(reply);
    }

    static async fillOutUserLocation(flow, locate, turnContext) {
        const input = turnContext.activity.text;
        let result;

        switch (flow.lastQuestionAsked) {
            case question.none:
                firstPrediction = false;

                await turnContext.sendActivity("Where are you going?");
                flow.lastQuestionAsked = question.tolocation;

                break;

            case question.tolocation:
                firstPrediction = false;
                var toLocationFlag = false;

                if(typeof(locate.tolocation) === "undefined") {
                    result = this.validateToLocation(input);

                    if (result.success) {
                        toLocationFlag = true;
                        locate.tolocation = result.tolocation;
                    }

                } else {
                    toLocationFlag = true;
                }
                
                if (toLocationFlag) {

                    var reply = MessageFactory.suggestedActions(['Lobby', 'Gate 1', 'Gate 2']);

                    await turnContext.sendActivity(`I have your destination as ${ locate.tolocation }.`);
                    await turnContext.sendActivity('From what location are you currently in?');
                    await turnContext.sendActivity(reply);

                    flow.lastQuestionAsked = question.fromlocation;
                    break;

                } else {
                    await turnContext.sendActivity(result.message || "I'm sorry, I didn't understand that.");
                    break;
                }

            case question.fromlocation:
                firstPrediction = false;
                var fromLocationFlag = false;

                if(typeof(locate.fromlocation) === "undefined") {
                    result = this.validateFromLocation(input);

                    if (result.success) {
                        fromLocationFlag = true;
                        locate.fromlocation = result.fromlocation;
                    }

                } else {
                    fromLocationFlag = true;
                }

                if (fromLocationFlag) {
                    var location = this.findPath(locate.fromlocation, locate.tolocation);

                    await turnContext.sendActivity(`I have your destination as ${ locate.tolocation } and current location as ${ locate.fromlocation }.`);
                    if (location.success) {
                        await turnContext.sendActivity(`Here is the path I found:  ${ location.path }.`);

                    } else {

                        await turnContext.sendActivity(`I'm sorry I can't find a path that from ${ locate.fromlocation } to ${ locate.tolocation }.`);
                        await turnContext.sendActivity("Please kindly inform my creator.");
                    }

                    flow.lastQuestionAsked = question.none;

                    dialogStatus = false;
                    firstPrediction = true;
                    locate = {};
                    break;

                } else {
                    await turnContext.sendActivity(result.message || "I'm sorry, I didn't understand that.");
                    break;
                }
        }
    }

    static findPath(findFromLocation, findToLocation) {
        const fs = require('fs');

        let rawdata = fs.readFileSync('from-to-location.json');
        let locations = JSON.parse(rawdata);
        
        for (var i = 0; i < locations.length; i++) {
            if (locations[i].fromLocation.toLowerCase() === findFromLocation.toLowerCase() && 
                locations[i].toLocation.toLowerCase() === findToLocation.toLowerCase()) {
                    return {
                        success: true,
                        path: locations[i].path
                    };
            }

            return {
                success: false
            };
        }
    }

    static validateToLocation(input) {
        const fs = require('fs');

        let rawdata = fs.readFileSync('valid-to-location.json');
        let validToLocations = JSON.parse(rawdata);

        for (var i = 0; i < validToLocations.length; i++) {
            if (validToLocations[i].location.toLowerCase() === input.toLowerCase()) {
                return {
                    success: true,
                    tolocation: input
                };
            }
        }

        return {
            success: false,
            message: `I'm sorry I can't accept ${ input } as destination. Please try another location.`
        };
    };

    static validateFromLocation(input) {
        const fs = require('fs');

        let rawdata = fs.readFileSync('valid-from-location.json');
        let validFromLocations = JSON.parse(rawdata);

        for (var i = 0; i < validFromLocations.length; i++) {
            if (validFromLocations[i].location.toLowerCase() === input.toLowerCase()) {
                return {
                    success: true,
                    fromlocation: input
                };
            }
        }

        return {
            success: false,
            message: `I'm sorry I can't accept ${ input } as current location. Please try another location.`
        };
    }
    
}

module.exports.SamcisBot = SamcisBot;