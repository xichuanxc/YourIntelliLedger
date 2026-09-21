# Development log — requests as sent

Every message typed into the assistant session that built this app, in order,
exactly as sent. Nothing is paraphrased, corrected or reordered; typing
slips are left as they were.

**151 messages** across **19 working days**, 12 August to 21 September 2026.

Extracted from the session transcript rather than retyped, so the wording is
the wording. Times are New Zealand time. Assistant replies, tool output and
system messages are deliberately absent — this is the record of what was
asked for, which is the half that documents the project's direction.

---

## Wednesday 12 August 2026

**17:17**

> I'm building different version for making the project ahead of schedule but still have enough to talk about in weekly meetings. Would report the week 4 later. What is your suggestion for this?

## Friday 14 August 2026

**08:00**

> By the way, how to build a release version(without dependence the laptop to run)?

**08:32**

> I'm sorry, I have to clarify that the iOS version could be a debug one, but I want it can be run directly without dependece of the laptop for the reactnative resources

**09:16**

> I didn't connect the phone at that moment. Please do it again.

**09:23**

> both Android and iOS devices are connected, if you can't find it, we will use previous way to demonstrate.

**09:26**

> restart metro so I can test the PAK'nSAVE receipt

**09:28**

> We should do the Android first

**09:47**

> Now let's work on the ios version.

**14:17**

> the phone is connected now, still get a red screen when it starts. Please check.

**14:25**

> [runtime not ready]: Error: Cannot create devtools websocket connections in embedded environments.

**14:31**

> I don't think it worths to use a 20 minuteo compilation for the realease version. Is it the only way?

**14:50**

> The iOS app works now, maybe because they are in the same subnet now?

**22:06**

> commit the changes

## Monday 17 August 2026

**10:35**

> One question, for week 5's task Integrate ML Kit OCR and barcode scanning into the app. What's 'barcode scanning' for?

**10:38**

> When it gets the barcode, what database does it use for looking up categories?

**10:40**

> Let's finished the final puzzle of week 5, barcode scanning and the Open Fodd Facts.

**12:41**

> what ad command should I run for Android

**12:44**

> Please troubleshoot the Android device, the app couldn't run properly now.

**13:10**

> The barcode scanning feature might not be a useful, we don't have to make decision now.
> Let's work on checking duplicated receipts now. Maybe you can use receipt date/time/amount for identifying the duplicated receipts? Or do you have other thinking?

**13:25**

> Let's check have we finished all the work by week 6?

**13:28**

> let's do raw_text first, what are the steps?

**13:32**

> It took nearly 20s for the parsing. It's not acceptable?

**13:43**

> It's a New world receipt on 21 Jun 2026. But taking photos on the test phone is a different thing, maybe you can add some log to see the picture size taken by the phone.

**13:45**

> And currently I have turned the option 'Send the receipt photo' off in Settings, I don't think the size of the pictures concerns the processing time.

**14:04**

> it's plugged now.

**14:20**

> check the log

**14:26**

> currently the app is using gemini-3.6-flash, how to change to a lite model? is it gemini-3.6-flash-lite?
> Let's display the prompt before trimming it.

**14:52**

> If we want to use other models, maybe it's time to build the backend which is userful to set different LLM access. What's your plan?

**17:13**

> Already have a Cloudflare account. Do you want to use the API?
> Stage A is enough for now.

**17:22**

> The wrangler has been delopyed. What's the next step?

**17:31**

> I chose xcnz but I can't find it now. Can you check to deploy?

**17:34**

> is there a web page for the deployment? I'd like to set the different LLM name and credentials for it.

**17:37**

> change ALIAS_PARSE_STRONG to gemini-3.6-flash-lite and check the log

**19:12**

> Are you using the cloudflare to forward the traffic, or connect to gemini directly from the mobile app?

**19:19**

> Does that mean cloudflare only returns the model name ??

**19:25**

> In my consideration, the cloudflare should work as a proxy, and all the LLM interactions should be forwarded within it. On mobile app side, it doesn't have to store the LLM model names and credentials. Would it be a big update? Let's discuss it before working on.

**19:34**

> The apple developer's account is not an urgent thing. It's ok if it only has a Android version. But your concern about the privacy is real. 
> So what is the function for the cloudclare in our spec?

**22:41**

> Yes, draft the build plan

## Tuesday 18 August 2026

**11:14**

> Please check if claude is working well.

## Wednesday 19 August 2026

**21:58**

> continue with unfinished work please.

## Saturday 22 August 2026

**16:18**

> Yes please test  thinking_level: "minimal" , then we would start Phase 1

**16:37**

> Now let's work on the week7 plan, mainly about the Ask part, is it? We can confirm the week 7 plan before do it.

## Wednesday 26 August 2026

**16:51**

> Now let's add a slide before 11. It should show the phone. I've got two pictures in docs/screenshot for it.

## Monday 7 September 2026

**10:13**

> Let's go on with further task. What's our next task?

**10:50**

> The play console account has been applied. But I don't think it could be a bottleneck for our project. Please go on with the next features in Week 7. 
> In my proposal, Week 7 plan is: Deploy the stateless hub + AI gateway; implement the natural-language query agent and the safe query validator; return correct answers to questions. Since we have temporalily give up the stateless hub + AI gateway, the remaining work is the others. Is it the same as the specification?

**11:57**

> please go ahead

**12:19**

> Keep going

**12:53**

> Please install the app on iphone(iphone se has been connected to the mac book)

**13:05**

> Test buttons for clear and import default receipts are developed on Android, how about iOS? Could you please add the same test buttons as well?

**13:17**

> The + button on the home page, navigate to 'Scan a receipt' by default. 
> Long-press could lead to current Add a receipt interface, but without a 'Setting' item. Is it clear?

**13:17**

> The + button on the home page, navigate to 'Scan a receipt' by default. 
> Long-press could lead to current Add a receipt interface, but without a 'Setting' item. Is it clear?

**13:23**

> For the Insights tab, the Period options must have more, like This Week/Last 4 weeks/Last 6 months
> Use appropriate way to fold the options, maybe a drop-down menu? Or things like that.

**13:34**

> The Ledger Ask Insights tabs covered the bottom item in Insights interface. Please fix it.

**14:36**

> Please go on with previous task.

**14:41**

> It looks ok now. What's the next?

**14:46**

> Before starts, does the Ask screen support voice input?

**14:48**

> Yes, go ahead with the text-only screen.

**14:55**

> I've got response 'I could not reach the assistant just now. Your ledger is still here, and the Insights tab works offline.'.

**15:00**

> The assistant service refused that request. This is a fault in the app rather than in you ledger - everything else still works. [dev] Function call is missing a thought_signature in functionCall parts.....

**15:27**

> It works now. If the result corresponds to a specific bill, please underline the related products and allows to be clicked to forward to the bill detail screen.

**15:31**

> Another thing is, the price should be compared by per unit. Particularly for Milk it should be per Litre. For eggs, it should be per egg.

**15:45**

> Then it comes to the parsing of the FRUIT CITY SUPERMARKET receipt. The Green Valley milk 2L, 2 for 7.5. That means 7.5nzd is for 2Lx2=4L milk. It shows explictly on the receipt. G/VALLY MILK 2L 2 FOR $7.5. Units sold is 2, but you didn't use units or scan units for calculating the price per Litre. Try to fix it.

**15:52**

> It still shows the Green Valley Milk 2L is 3.75/litre. What happens? Maybe this should be fixed in the receipt parsing part?

**15:57**

> It shows: Units sold 2, in Items sub-data, Category Dairy is right, Quantity 2 is right, Price 7.5 is right, but Unit should not be L, maybe pack is better? Scan units is 2 which is also right.

**19:44**

> go on with unfinished task.

**19:55**

> Please re install the app to the iphone se now. I would clear all history data and test.

**20:11**

> Cleared and rescanned, the Green Valley line shows pack now

**20:38**

> Please answer the question and you don't have to do anything about it: Does the receipt parser use the same endpoint?

**21:22**

> Let's use Ask on this Endpoint at first. I might use other LLM for the Ask feature.

**21:35**

> Have you deloyed the hub ?

**21:37**

> Could the hub have a dashboard or config interface to set LLM api? Currently it should support Gemini and DeepSeek

**21:50**

> Is there an item for setting the credential to access the LLM?

**21:53**

> Do the small fix now please.

## Tuesday 8 September 2026

**09:50**

> Please don't use Chinese names as hints of 'Name as printed' field. It's confusing.

**10:17**

> Try to find other Placeholder for mannual edit feature, do not confusing the users.

**11:43**

> When a receipt needs to be reviewed, how to clear the review needed indicator? Currently, even after reviewing, the indicator still appears.

**22:32**

> What's the next task for week 7?

**22:37**

> Yes please

## Wednesday 9 September 2026

**11:39**

> The new app, I asked 'How many milk did I buy so far' but only got The provider rejected the request. Please troubleshoot it.

**11:49**

> Bug fixing: In Ask screen, after clikcing the text box, input method pops up-that's ok. But it can't be canceled, and there is no way to change to other screen because the bottom buttons are covered by the input method.

**11:53**

> install it and I'll retry the milk question

**12:02**

> A new bug commes. In the Ask screen, when I click the coversation text part, the input-method disappears-it's what expected, but the history chat text can not be scrolled. Fix it.

**12:23**

> Now let's discuss about the categories, is it possible to separate the fruit from vegetables?

**12:53**

> Write it up as a optional plan for Week 9. Then let's go on with other work for week 7.

**13:09**

> OK Please go on

## Friday 11 September 2026

**11:17**

> Show me the challenge concisely when we developed the nature-language agent for queries.

**11:25**

> I'm working on an overleaf doc. Please fill the items with this format:
> \subsection{Challenges Encountered and Mitigation}
> \begin{itemize}
>     \item \textbf{Chanllege 1:} . 
>     \begin{description}
>         \item[Impact:] The user experience is bad while waiting for results
>         \item[Handling Strategy:] Use different models like gemini-3.5-flash
>     \end{description}
> \end{itemize}

**11:27**

> And the next week goals, plan it according to our proposal:
> \subsection{Planned Objectives for Next Week}
> \begin{enumerate}
>     \item Implement the natural-language query agent and the safe query validator, return correct answers to questions.
> \end{enumerate}

**11:48**

> Currently, in the Ask screen, asking 'Show me the cheapest rice I have bought', but got the answer 'Invalid JSON payload received. Unknown name "stream": Cannot find field '

## Saturday 12 September 2026

**10:49**

> After demonstrating to the lecturer, she thought it was a funny app. Let's work on the features for next week.

**11:12**

> The Android phone has connected. Build the Android version please. I would like to test it.

**11:24**

> usage

**12:32**

> On Ask screen of the Android phone, after clicking the text box the input method comes, but the input method screen overlaps the text box (as well as the send button). Please fix it.

**12:36**

> OK. BTW, this application should only run on a real cellphone, if there are only emulators, don't launch it, the emulators work for other projects.

**12:40**

> OK let's go.

**12:47**

> Pleae ignore the emulators, there are using for another project. They have to run now.

**14:30**

> The input method soft keyboard doesn't cover the text input box now. But it along with the text box covers the latest conversation.

**15:44**

> Go on with unfinished task.

## Sunday 13 September 2026

**09:21**

> Show me the receipt parsing prompt to LLM, and could you please update it in our specification as well?

**23:32**

> Let's go on with further features for Week 8.

**23:52**

> How about the most frequently asked questions? I know it should depend on individuals, we may save most frequently questions for the user, could you add this feature?

## Monday 14 September 2026

**10:23**

> The samsung A03 has been connected. Please install the lastest version for testing.

**10:25**

> Keep the thinkingLevel change, I'll test the speed

**10:28**

> The app on Samsung A03 stays in the Welcome screen, looks like it doesn't have downloaded the resources files.

**10:40**

> In settings screen, the logic of saving reading receipts key and Ask key is confusing. How to save the Ask key?
> Please add a check box for ASK to use the same key as reading receipts. (if it is not checked, enable a box and an independent button for saving it.

**11:14**

> Please also add an option in settings screen to save Ask conversation records. In Ask screen, provide a ... button for clear the conversation records.

**11:28**

> Let's go on with fastpaths for Week 8. As soon as clicking a historic text I have sent, it should display a menu to ask if the user wants to duplicate the text to current question text box. Is it clear?

**11:55**

> Show me the future works so I can report to my supervisor.

**13:11**

> A small feature, when clicking back button on Ledger screen, pop up a dialogue to ask if the user wants to exit the app.

**15:09**

> In Insight screen, please add a map view to show the locations of merchants with an aggregation to show the cost during the selected period.

**15:25**

> The map view should have zoom in/out button to avoid overlapped merchants. Please show the spots on the map transparently and with the supermarket

**15:25**

> The map view should have zoom in/out button to avoid overlapped merchants. Please show the spots on the map transparently and with the supermarket

**15:27**

> The map view should have zoom in/out button to avoid overlapped merchants. Please show the spots on the map transparently and with the supermarket's represented color, like PakNSave - yellow, New World-red, Woolworth - green, and so on. not famous ones could have one specific color to indicate.

**15:40**

> Have you done with the rebuild?

**15:47**

> The Zoom in / out buttons work, but the center of the map can't be moved, users might want to move the map in the view for more detailed information especially after zoomming in or off.

**16:30**

> For the map view in Insights, could you please show the aggregation amount for every merchants? Duplicated merchants should display only one aggregation, don't show bills as every spot. Don't response screen scroll in the map view area.

## Tuesday 15 September 2026

**22:10**

> I'm writing this project to my resume. Please generalize it for me:
> \textit{Programming Project} \hfill \textit{Master's Assignment Project}
> \begin{itemize}
>     \item Developed a cross-platform intelligent ledger application for .
> \end{itemize}

**22:11**

> No, I only want one sentence.

**22:12**

> Use the technical version

## Friday 18 September 2026

**14:55**

> The fastpath doesn't work well. For example, I use the shortcut 'Please show me how much did I cost in last month', it works. But when I changed to Please show me how much did I cost on milk last month, it is still the same result what doesn't make sense. How does the fastpath work?

**15:03**

> I can't test every situation, the implementation should be feasible flexible and feasible.

**22:16**

> Let go on.

**22:22**

> My lecturer proposed a requirement, in Ask screen, could the app hint question relevant to previous quesion or answer? How to implement it? Should it use LLM?

**22:42**

> OK Please go ahead.

## Saturday 19 September 2026

**05:33**

> What about the map preview in Insights screen. when clicking the edge of it(The upper or the down edge), the touch and move events are not relevant to move map but move the items in Insight screen. is it clear?

**05:39**

> In insight screen. Let's optimise the time period. Current period could be kept the same row but on the left. The right should be used to select start date to end date for a completely self-define period.

## Sunday 20 September 2026

**10:22**

> iPhoneSE has been plugged in. Please install it.

**11:15**

> When scanning multiply pages, could it be from different merchants? Let's discuss this. If it is hard to handle this automatically, is it possible to add an option for this situation?

**11:38**

> I want an option check box in scanning screen, to show if the photos are seperated ones or a singole one.

**12:03**

> Please install it on iPhone SE.

**12:06**

> This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.

**12:07**

> After scanning 2 receipts and setting seperate pages, the parsing of first receipt gave the error message: ❯ This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.

**12:24**

> No. Two receipts text to the LLM doesn't work. But one receipt text works. Maybe you can do seperate receipts one by one?

**12:29**

> The follow-up hint quesions have used a big card to display, try to display is compactly.

## Monday 21 September 2026

**10:35**

> The samsung has been connected, please work on it. Update the app and I would like to confirm if the modifications work.

**10:51**

> On the Ask screen, the follow-up chips have taken too much space and covered nearly half of the conversation box. Make the follow-up chips compact and above the question input text box.

**11:05**

> Now please add a new Period Last week in Insights screen, and set last 4 weeks as the default period. Save the option in our parameter file(if there is a parameter file). And the chat text in Ask screen should also be saved until the user cleans it explictly. Is is clear enough?

**11:25**

> Please show a indicator for the follow-up chips (Show the user it can be left-scroll or right-scroll).

**11:37**

> When it display charts in conversation box, clicking the question text box and the input method pops up, the charts would be covered. Fix it if you can. 
> And in the charts, the full text of labels for x-axis can't be displayed explictly, figure out it, maybe tilted display would be a choice? Or other choice if you want.

**11:41**

> The + and - and o button on the map preview in Insights don't work. Please fix it, it might be covered by reponsing the screen scroll events?
> I also want to use common touch screen gesture to zoom in and zoom out(two fingers gesture as you know).

**11:47**

> On the map preview in Insights screen, please display the merchant name with the merchant aggregation amount.
> And the labels with bigger amount should overlap smaller ones.

**11:50**

> Because the x-axis labels have been tilted displayed, don't use ... but please display the full text of the labels, is it clear?

**11:53**

> Please take a screenshot now , the x-axis labels on the chart of Ask screen are not shown in the right position. Please fix it.

**12:03**

> It looks much better. Please commit it now.

**12:41**

> Install it on the iPhone SE please

**12:42**

> Let's go on with confirmation cards for Week 8.

**13:14**

> For the map preview on Insights screen, please organise the labels automatically to avoid overlapping as much as you can. the amount should after the merchant name, not below it.

**15:47**

> Samsung has been connected

**15:50**

> Yes please add sideways placement, let's have a look.

**16:02**

> Let's work on the labels on map preview of Insights screen. Automatically might be ambiguous. I want you to decide the position of the label, after the decicion, no matter zoom in or out, the positions should be fixed. Is it clear? And the amount number and label text could be 1.5x bigger, to fill the white chips.

**16:10**

> Could you please generate a document to save the entire chat records that I send.
