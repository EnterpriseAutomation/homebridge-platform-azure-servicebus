// var SQSWorker = require('sqs-worker');
const { ServiceBusClient, ReceiveMode } = require("@azure/service-bus");

var Accessory, Service, Characteristic, UUIDGen;



module.exports = function (homebridge) {

  // Accessory must be created from PlatformAccessory Constructor
  Accessory = homebridge.platformAccessory;

  // Service and Characteristic are from hap-nodejs
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  // For platform plugin to be considered as dynamic platform plugin,
  // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
  homebridge.registerPlatform("homebridge-platform-azure-servicebus", "AzureServiceBus", AzureServiceBusPlatform, true);
}

function AzureServiceBusPlatform(log, config, api) {

  //just capture the input, we'll set it up in accessories
  this.log = log;
  this.config = config;
  this.api = api;
}

AzureServiceBusPlatform.prototype = {
  accessories: function (callback) {
    var i;

    var self = this;

    this.incomingQueueName = this.config.incomingQueueName;
    this.outgoingQueueName = this.config.outgoingQueueName;

    this.log(this.incomingQueueName);
    this.log(this.outgoingQueueName);

    this.log("Creating incoming service bus message client");
    this.incomingServiceBusClient = ServiceBusClient.createFromConnectionString(this.config.incommingMessageConnectionString);
    this.incomingQueueClient = this.incomingServiceBusClient.createQueueClient(this.incomingQueueName);

    this.log("Creating outgoing service bus message client");
    this.outgoingServiceBusClient = ServiceBusClient.createFromConnectionString(this.config.outgoingMessageConnectionString);
    this.outgoingQueueClient = this.outgoingServiceBusClient.createQueueClient(this.outgoingQueueName);

    this.log("creatingSender");
    this.sender = this.outgoingQueueClient.createSender();
    this.log("finished creating sender");

    var myAccessories = [];

    this.log("Pulling Config for incoming switches");
    var foundIncomingAccessories = this.config.incomingSwitches;
    this.log("Incoming Config = " + JSON.stringify(foundIncomingAccessories, null, 4));


    this.log("Pulling Config for outgoing Buttons");
    var foundOutgoingAccessories = this.config.outgoingButtons;
    this.log("Outgoing Config = " + JSON.stringify(foundOutgoingAccessories, null, 4));

    // create hashtable map of accessories based 
    // on name for perf in large collections
    var _accessoryMap = {};
    var myAccessories = [];

    for (var i = 0; i < foundIncomingAccessories.length; i++) {
      var incomingAccessory = new AzureServiceBusAccessoryIncomingSwitch(this.log, foundIncomingAccessories[i]);
      myAccessories.push(incomingAccessory);
      _accessoryMap[incomingAccessory.name] = incomingAccessory;
      this.log('Created ' + incomingAccessory.name + ' Accessory (Incoming)');
    }

    for (var i = 0; i < foundOutgoingAccessories.length; i++) {
      var outgoingAccessory = new AzureServiceBusAccessoryOutgoingButton(this.log, foundOutgoingAccessories[i]);
      outgoingAccessory.sender = this.sender;
      myAccessories.push(outgoingAccessory);
      this.log('Created ' + outgoingAccessory.name + ' Accessory (Outgoing)');
    }

    callback(myAccessories);

    this.accessoryMap = _accessoryMap;

    this.receiver = this.incomingQueueClient.createReceiver(ReceiveMode.receiveAndDelete);

    this.log("creating message handler");
    this.receiver.registerMessageHandler(function (brokeredMessage) {
      self.log("message received: " + JSON.stringify(brokeredMessage.body, null, 4));

      var obj = brokeredMessage.body;

      // if( obj.target === self.name)
      if (!(obj.target in self.accessoryMap)) {
        self.log("Accessory Name '" + obj.target + "' not found, ignoring and deleting message " + brokeredMessage.id);
        return;
      }

      self.log("Accessory " + obj.target + " found. Processing message");

      var acc = self.accessoryMap[obj.target];

      acc.toggleButton();
    },
      function (err) {
        self.log("error occured: " + err);
      },
      {
        autoComplete: true
      });
    this.log("finished creating message handler");


  },
  removeAccessory: function (accessory) {
    if (accessory) {
      this.api.unregisterPlatformAccessories("homebridge-amazondash", "AmazonDash", [accessory]);
    }
  }
}


//an accessorary, eg a button. This one is mostly just an on/off state button.
//SQS message toggles it, as does pressing it in the home app
function AzureServiceBusAccessoryIncomingSwitch(log, accessory) {
  this.log = log;
  this.accessory = accessory;
  this.name = this.accessory.name;
  this.buttonIsOn = false;
  this.buttonLastToggledState = false;
  this.isTimeoutButton = this.accessory.isTimeoutButton === true;

  if (this.isTimeoutButton) {
    this.buttonTimeout = this.accessory.buttonTimeout;
  }
  else {
    this.buttonTimeout = -1;
  }
}

AzureServiceBusAccessoryIncomingSwitch.prototype = {
  toggleButton: function () {
    var self = this;

    //toggle the internal state of the button
    this.buttonIsOn = !this.buttonIsOn;
    this.buttonLastToggledState = this.buttonIsOn;
    this.log(`${this.name}: Azure ServiceBus Button state change. New state is ${this.buttonIsOn}`);
    this.service.getCharacteristic(Characteristic.On).setValue(this.buttonIsOn);

    if (this.isTimeoutButton === true) {
      self.log("Found Button is timeout button. Will reset to previous state in " + this.buttonTimeout.toString() + "ms");

      setTimeout(function () {
        self.log(`${self.name}: Timeout complete`);
        self.buttonIsOn = !self.buttonLastToggledState;
        self.buttonLastToggledState = self.buttonIsOn;

        self.log(`${self.name}: Azure ServiceBus Button state change. New state is ${self.buttonIsOn}`);
        self.service.getCharacteristic(Characteristic.On).setValue(self.buttonIsOn);
      },
        self.buttonTimeout);
    }
  },

  identify: function (callback) {
    this.log("[" + this.name + "] Identify requested!");
    callback(); // success
  },

  getServices: function () {
    //get the services this accessory supports
    //this is were we setup the button, but if it was, eg, a fan, you'd make a fan here.

    var services = [];

    var informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Manufacturer, 'Fargo Bose Security');

    var switchService = new Service.Switch(this.accessory.name);
    switchService
      .getCharacteristic(Characteristic.On)
      .on('get', this.getSPState.bind(this))
      .on('set', this.setSPState.bind(this));

    informationService
      .setCharacteristic(Characteristic.Model, 'Incoming Service Bus Message')
      .setCharacteristic(Characteristic.SerialNumber, '1.0');

    services.push(switchService, informationService);

    //keep the service, so we can turn it on/off later.
    this.service = switchService;

    return services;
  },

  getSPState: function (callback) {
    //homekit calling into us to get the state
    this.log(`${this.name}: Get State: ${this.buttonIsOn}`);
    callback(null, this.buttonIsOn);
  },

  setSPState: function (state, callback) {

    //homekit calling into us to set the state. state is 1 or 0
    if (state) {
      this.buttonIsOn = true;
    } else {
      this.buttonIsOn = false;
    }
    this.log(`${this.name}: CALL FROM HOMEKIT. Set State to ${this.buttonIsOn}`);
    callback(null, this.buttonIsOn);

  }
}


//an accessorary, eg a button. This one is mostly just an on/off state button.
//SQS message toggles it, as does pressing it in the home app
function AzureServiceBusAccessoryOutgoingButton(log, accessory) {
  this.log = log;
  this.accessory = accessory;
  this.name = this.accessory.name;
  this.buttonIsOn = false;
}

AzureServiceBusAccessoryOutgoingButton.prototype = {
  toggleButton: function () {
    var self = this;

    //toggle the internal state of the button
    this.buttonIsOn = !this.buttonIsOn;
    this.buttonLastToggledState = this.buttonIsOn;
    this.log(`${this.name}: Azure ServiceBus Button state change. New state is ${this.buttonIsOn}`);
    this.service.getCharacteristic(Characteristic.On).setValue(this.buttonIsOn);


  },

  identify: function (callback) {
    this.log("[" + this.name + "] Identify requested!");
    callback(); // success
  },

  getServices: function () {
    //get the services this accessory supports
    //this is were we setup the button, but if it was, eg, a fan, you'd make a fan here.

    var services = [];

    var informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Manufacturer, 'Fargo Bose Security');

    var switchService = new Service.Switch(this.accessory.name);
    switchService
      .getCharacteristic(Characteristic.On)
      .on('get', this.getSPState.bind(this))
      .on('set', this.setSPState.bind(this));

    informationService
      .setCharacteristic(Characteristic.Model, 'Outgoing Service Bus Message')
      .setCharacteristic(Characteristic.SerialNumber, '1.0');

    services.push(switchService, informationService);

    //keep the service, so we can turn it on/off later.
    this.service = switchService;

    return services;
  },

  getSPState: function (callback) {
    //homekit calling into us to get the state
    this.log(`${this.name}: Get State: ${this.buttonIsOn}`);



    callback(null, this.buttonIsOn);
  },

  setSPState: function (state, callback) {
    var self = this;

    //homekit calling into us to set the state. state is 1 or 0
    if (state) {
      this.buttonIsOn = true;

      self.log("Found Button is timeout button. Will reset to previous state in 500ms");

      setTimeout(function () {
        self.log(`${self.name}: Timeout complete`);
        self.buttonIsOn = false;

        self.service.getCharacteristic(Characteristic.On).setValue(self.buttonIsOff);
      },
      500);

      var msg = {
        body: {
          source: this.name
        }
      };

      this.log("Sending service bus message");
      this.sender.send(msg);

      callback(null, this.buttonIsOn);
    } else {
      this.buttonIsOn = false;

      callback(null, this.buttonIsOff);
    }



  }
}